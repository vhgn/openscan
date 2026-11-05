/**
 * Deterministic triage and the report summary (engine.ts `triage`, heuristic engine),
 * plus finding dedupe and product memory across scans.
 * The AI triage path (ranking, false positives vs validator verdicts) is covered in e2e-scan.test.ts.
 */
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createScan, runStep } from '#/lib/scanner/engine'
import { listFindings } from '#/lib/queries'
import { saveProduct } from '#/lib/products'
import {
  assertNoUnexpectedFetch,
  drain,
  insertRepo,
  insertUser,
  resetEnv,
  scanRow,
  serveOsv,
  serveRepo,
  setPreferences,
  stubFetch,
  type FetchStub,
  type TestEnv,
} from './helpers/harness.ts'
import { LODASH_VULN, SHOP_FILES } from './helpers/fixtures.ts'

let t: TestEnv
let f: FetchStub
beforeEach(() => {
  t = resetEnv({ AI_MODE: 'heuristic' })
  f = stubFetch()
})
afterEach(() => f.restore())

async function scan(files: Record<string, string>, opts: { vulns?: typeof LODASH_VULN; prefs?: Record<string, unknown> } = {}) {
  const user = insertUser(t)
  const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
  if (opts.prefs) setPreferences(t, user, opts.prefs)
  serveRepo(f, { fullName: 'acme/shop', files })
  serveOsv(f, opts.vulns ?? {})
  const id = await createScan(user, repo, 'security', 'manual')
  await drain(t, runStep)
  const row = scanRow(t, id)
  assert.equal(row.status, 'completed')
  return { user, repo, id, summary: JSON.parse(row.summary_json!) }
}

const ENGINE_NOTE = 'Heuristic mode: link ChatGPT for AI-verified findings, independent validation (fp-check) and research.'

test('deterministic triage: severity × confidence ranking and the summary shape', async () => {
  const { id, summary } = await scan(SHOP_FILES, { vulns: LODASH_VULN })
  assert.deepEqual(summary, {
    headline: 'Fix first: lodash@4.17.15 has 1 known vulnerability (package-lock.json).',
    riskLevel: 'critical',
    whatMatters: [
      'CRITICAL: lodash@4.17.15 has 1 known vulnerability',
      'HIGH: Hard-coded credential-like value',
      'HIGH: SQL built with string concatenation/interpolation',
      'MEDIUM: Dynamic code evaluation',
    ],
    nextActions: [
      { action: 'Upgrade lodash to a fixed version (4.17.19 or later).', why: 'lodash@4.17.15 has 1 known vulnerability', effort: 'small' },
      { action: 'Move the value to environment/secret storage and rotate it.', why: 'Hard-coded credential-like value', effort: 'small' },
      { action: 'Use parameterized queries / the ORM query builder.', why: 'SQL built with string concatenation/interpolation', effort: 'small' },
    ],
    stats: { critical: 1, high: 2, medium: 1, low: 0, info: 0 },
    filesReviewed: 4,
    dependenciesChecked: 2,
    engineNote: ENGINE_NOTE,
    validation: { confirmed: 0, needs_validation: 0, rejected: 0, unverified: 4 },
    needsValidation: [],
    memory: { skippedFiles: 0, reusedVerdicts: 0, carriedFindings: 0 },
  })
  // High/medium-confidence secret outranks the low-confidence SQL heuristic of the same severity.
  const order = t.db.rows<{ title: string; confidence: string }>('SELECT title, confidence FROM findings WHERE scan_id = ? ORDER BY priority', id)
  assert.deepEqual(order.slice(1, 3).map((r) => r.confidence), ['medium', 'low'])
  assertNoUnexpectedFetch(f)
})

test('a clean repository reports no risk', async () => {
  const { summary } = await scan({ 'README.md': '# Hello', 'src/index.ts': 'export const x = 1' })
  assert.equal(summary.headline, 'No security issues detected in the reviewed files.')
  assert.equal(summary.riskLevel, 'none')
  assert.deepEqual([summary.whatMatters, summary.nextActions], [[], []])
  assert.deepEqual(summary.stats, { critical: 0, high: 0, medium: 0, low: 0, info: 0 })
})

test('info-only findings are reported as low risk', async () => {
  const lock = JSON.stringify({ packages: { '': {}, 'node_modules/esbuild': { version: '0.25.0', hasInstallScript: true } } })
  const { summary } = await scan({ 'README.md': '# Hello', 'package-lock.json': lock })
  assert.equal(summary.riskLevel, 'low')
  assert.equal(summary.headline, 'Fix first: 1 production dependency runs install-time scripts (package-lock.json).')
  assert.deepEqual(summary.whatMatters, ['INFO: 1 production dependency runs install-time scripts'])
  assert.deepEqual(summary.stats.info, 1)
})

test('triage ranks and counts only open findings', async () => {
  const user = insertUser(t)
  const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
  serveRepo(f, { fullName: 'acme/shop', files: SHOP_FILES })
  serveOsv(f)
  const id = await createScan(user, repo, 'security', 'manual')
  while (scanRow(t, id).phase !== 'triage') await runStep(t.queue.shift()!.scanId)
  t.db.write(`UPDATE findings SET status = 'dismissed' WHERE title = 'Dynamic code evaluation'`)
  await drain(t, runStep)
  const summary = JSON.parse(scanRow(t, id).summary_json!)
  assert.deepEqual(summary.stats, { critical: 0, high: 2, medium: 0, low: 0, info: 0 })
  assert.equal(t.db.row<{ priority: number | null }>(`SELECT priority FROM findings WHERE title = 'Dynamic code evaluation'`)!.priority, null)
  assert.equal(summary.validation.unverified, 3, 'validation counts include dismissed findings')
})

test('focus without dependencies skips OSV entirely', async () => {
  const user = insertUser(t)
  const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
  setPreferences(t, user, { focus: ['code', 'secrets'] })
  serveRepo(f, { fullName: 'acme/shop', files: SHOP_FILES }) // no OSV route: any OSV call is unexpected
  const id = await createScan(user, repo, 'security', 'manual')
  await drain(t, runStep)
  assert.equal(JSON.parse(scanRow(t, id).summary_json!).dependenciesChecked, 0)
  assert.equal(t.db.row<{ n: number }>(`SELECT COUNT(*) AS n FROM findings WHERE source = 'osv'`)!.n, 0)
  assertNoUnexpectedFetch(f)
})

test('findings are fingerprinted per scan: a rerun of the same step adds no duplicates', async () => {
  const user = insertUser(t)
  const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
  serveRepo(f, { fullName: 'acme/shop', files: SHOP_FILES })
  serveOsv(f, LODASH_VULN)
  const id = await createScan(user, repo, 'security', 'manual')
  await runStep(t.queue.shift()!.scanId) // init
  const afterInit = scanRow(t, id).state_json
  await runStep(t.queue.shift()!.scanId) // deps
  const count = () => t.db.row<{ n: number }>('SELECT COUNT(*) AS n FROM findings WHERE scan_id = ?', id)!.n
  assert.equal(count(), 1)
  // Simulate a redelivered message for the deps step (e.g. a crash after saving findings).
  t.db.write(`UPDATE scans SET phase = 'deps', state_json = ? WHERE id = ?`, afterInit, id)
  await runStep(t.queue.shift()!.scanId)
  assert.equal(count(), 1)
})

test(
  'scanning a repository outside any product keeps the existing product intact',
  async () => {
    const user = insertUser(t)
    insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    insertRepo(t, { id: 2, fullName: 'vercel/next.js', users: [{ id: user }] })
    await saveProduct(user, { name: 'My SaaS', description: 'Our product', repoIds: [1] })
    serveRepo(f, { fullName: 'vercel/next.js', files: { 'README.md': '# next' } })
    serveOsv(f)
    await createScan(user, 2, 'security', 'manual')
    await drain(t, runStep)
    const product = t.db.row<{ name: string; description: string | null }>('SELECT name, description FROM products WHERE user_id = ?', user)!
    assert.deepEqual(product, { name: 'My SaaS', description: 'Our product' })
  },
)

async function rescan(user: string, repo: number) {
  const id = await createScan(user, repo, 'security', 'manual')
  await drain(t, runStep)
  assert.equal(scanRow(t, id).status, 'completed')
  return { id, summary: JSON.parse(scanRow(t, id).summary_json!) }
}

const findingsOf = (scanId: string) =>
  t.db.rows<{ title: string; status: string; fingerprint: string; carried_from: string | null }>('SELECT title, status, fingerprint, carried_from FROM findings WHERE scan_id = ? ORDER BY title', scanId)

test('a rescan of unchanged code keeps its open findings in the latest report', async () => {
  const first = await scan(SHOP_FILES)
  assert.equal(first.summary.stats.high, 2)
  const again = await rescan(first.user, first.repo)
  assert.equal(again.summary.memory.skippedFiles, 4)
  assert.equal(again.summary.memory.carriedFindings, 3)
  assert.equal(again.summary.filesReviewed, 0, 'nothing was re-reviewed')
  // The carried findings count toward the report exactly as in the first scan.
  assert.deepEqual(again.summary.stats, first.summary.stats)
  assert.equal(again.summary.riskLevel, first.summary.riskLevel)
  assert.equal(again.summary.headline, first.summary.headline)
  const titles = (await listFindings(first.user)).map((x) => x.title)
  assert.ok(titles.includes('Hard-coded credential-like value'), `latest report lost the committed API key: ${JSON.stringify(titles)}`)
  assert.deepEqual(titles, ['Hard-coded credential-like value', 'SQL built with string concatenation/interpolation', 'Dynamic code evaluation'])
  const carried = findingsOf(again.id)
  assert.deepEqual(
    carried.map((x) => [x.fingerprint, x.carried_from]),
    findingsOf(first.id).map((x) => [x.fingerprint, first.id]),
    'same fingerprints, traced back to the scan that reviewed the code',
  )
  // A third scan carries them again, still pointing at the reviewing scan.
  const third = await rescan(first.user, first.repo)
  assert.deepEqual(findingsOf(third.id).map((x) => x.carried_from), [first.id, first.id, first.id])
  assert.equal(third.summary.stats.high, 2)
})

test('a rescan does not bring back findings the user dismissed or fixed', async () => {
  const first = await scan(SHOP_FILES)
  // Dismissed on the first report.
  t.db.write(`UPDATE findings SET status = 'dismissed' WHERE scan_id = ? AND title = 'Dynamic code evaluation'`, first.id)
  const second = await rescan(first.user, first.repo)
  assert.deepEqual(findingsOf(second.id).map((x) => x.title), ['Hard-coded credential-like value', 'SQL built with string concatenation/interpolation'])
  assert.deepEqual(second.summary.stats, { critical: 0, high: 2, medium: 0, low: 0, info: 0 })
  // Fixed on the second (latest) report, which holds the carried copy.
  t.db.write(`UPDATE findings SET status = 'fixed' WHERE scan_id = ? AND title = 'Hard-coded credential-like value'`, second.id)
  const third = await rescan(first.user, first.repo)
  assert.deepEqual(findingsOf(third.id).map((x) => x.title), ['SQL built with string concatenation/interpolation'])
  assert.deepEqual(third.summary.stats, { critical: 0, high: 1, medium: 0, low: 0, info: 0 })
  assert.equal(third.summary.riskLevel, 'high')
  assert.deepEqual((await listFindings(first.user)).map((x) => x.title), ['SQL built with string concatenation/interpolation'])
  // The user's decisions on earlier reports are left as they were.
  assert.deepEqual(
    [...findingsOf(first.id), ...findingsOf(second.id)].map((x) => [x.title, x.status]),
    [
      ['Dynamic code evaluation', 'dismissed'],
      ['Hard-coded credential-like value', 'open'],
      ['SQL built with string concatenation/interpolation', 'open'],
      ['Hard-coded credential-like value', 'fixed'],
      ['SQL built with string concatenation/interpolation', 'open'],
    ],
  )
  // Reopening on the latest report brings it back in the next scan.
  t.db.write(`UPDATE findings SET status = 'open' WHERE scan_id = ? AND title = 'Hard-coded credential-like value'`, second.id)
  const fourth = await rescan(first.user, first.repo)
  assert.equal(fourth.summary.stats.high, 2)
})

test('a changed file is reviewed again and its old findings are not carried', async () => {
  const first = await scan(SHOP_FILES)
  serveRepo(f, { fullName: 'acme/shop', files: { ...SHOP_FILES, 'src/auth.ts': 'export const API_KEY = process.env.API_KEY\nexport function login() {}' } })
  const second = await rescan(first.user, first.repo)
  assert.equal(second.summary.memory.skippedFiles, 3)
  assert.deepEqual(
    findingsOf(second.id).map((x) => [x.title, x.carried_from]),
    [
      ['Dynamic code evaluation', first.id],
      ['SQL built with string concatenation/interpolation', first.id],
    ],
  )
})
