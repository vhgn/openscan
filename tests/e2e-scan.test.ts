/**
 * End to end: onboarding "AI reads your repo" scan followed by the automatic security
 * report, on the AI engine with a stubbed LLM (tests/helpers/llm.ts), stubbed GitHub
 * and OSV, and an in-memory D1. Only the model's answers are fake; every prompt goes
 * through the real askJson -> AI SDK structured output -> zod -> engine path.
 */
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mockChatGPT, type LlmCall } from './helpers/llm.ts'
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

const SQLI = 'SQL injection in /search handler'
const RATE = 'Login has no rate limiting'
const VERBOSE = 'Verbose error pages'
const MISSING_FACT = 'Is there a rate limit for /login at the load balancer?'

function finding(over: Record<string, unknown>) {
  return {
    severity: 'medium',
    category: 'code',
    file: 'src/server.ts',
    line: 3,
    description: 'desc',
    threatModel: 'An attacker with network access can send requests to achieve impact',
    trace: ['src/server.ts:3 — req.query.q flows into db.query'],
    impact: 'impact',
    recommendation: 'fix it',
    confidence: 'high',
    ...over,
  }
}

/** The "model": deterministic answers per agent role. */
function respond(call: LlmCall): unknown {
  switch (call.role) {
    case 'reader':
      return {
        notes: ['Express HTTP server in src/server.ts', 'UNENFORCED: admin routes assume a reverse proxy adds auth'],
        questions: [{ question: 'Is the admin panel exposed to the internet?', rationale: 'Changes the severity of admin findings' }],
        answers: [],
      }
    case 'architect': {
      const qid = /\[([^\]]+)\] Is the admin panel exposed/.exec(call.prompt)?.[1]
      return {
        summary: 'A storefront API',
        stack: ['Node.js', 'Express'],
        entryPoints: ['src/server.ts'],
        dataStores: ['PostgreSQL'],
        auth: 'Static API key in src/auth.ts',
        externalServices: ['Stripe'],
        deployment: 'Unknown',
        sensitiveAreas: ['src/server.ts'],
        notes: ['The search endpoint is public'],
        answers: qid ? [{ questionId: qid, answer: 'No, only over the VPN', evidence: 'README.md' }] : [],
      }
    }
    case 'reviewer':
      return {
        findings: [
          finding({ severity: 'high', title: SQLI }),
          // The same claim reworded only in case/punctuation: deduped by fingerprint.
          finding({ severity: 'high', title: 'SQL Injection in /search handler.' }),
          finding({ title: RATE, file: 'src/auth.ts', line: 2 }),
          finding({ severity: 'low', title: VERBOSE, line: 5 }),
        ],
        questions: [{ question: 'Is /search behind authentication?', rationale: 'Decides exposure' }],
        answers: [],
      }
    case 'validator': {
      const base = { restatedClaim: 'claim', gates: { reachability: 'pass', realImpact: 'pass', noPreventingControl: 'pass', environment: 'unknown' }, brocardFailed: 0, reasoning: 'traced it' }
      if (call.prompt.includes(SQLI)) return { ...base, decision: 'confirmed', severity: 'critical', missingFact: '', correctedRecommendation: 'Use parameterized queries' }
      return { ...base, decision: 'needs_validation', severity: 'medium', missingFact: MISSING_FACT, correctedRecommendation: '' }
    }
    case 'triage': {
      const order = [SQLI, 'lodash', RATE, VERBOSE]
      const ranking = [...call.prompt.matchAll(/^#(\d+) \[(\w+)\/[^\]]*\] (.+?) \(/gm)].map(([, index, severity, title]) => ({
        index: Number(index),
        priority: order.findIndex((o) => title.includes(o)) + 1,
        // Tries to downgrade the confirmed SQLi and to dismiss it: the validator's verdict wins.
        severity: title === SQLI ? 'high' : severity,
        falsePositive: title === SQLI || title === VERBOSE,
      }))
      return {
        headline: 'Fix the SQL injection in /search before anything else.',
        riskLevel: 'critical',
        whatMatters: ['Search is injectable', 'lodash is outdated'],
        nextActions: [{ action: 'Parameterize the search query', why: 'Full database read', effort: 'small' }],
        ranking,
        research: [],
      }
    }
    default:
      throw new Error(`unexpected LLM call: ${call.system.slice(0, 80)}`)
  }
}

const llm = mockChatGPT(respond)
// Loaded after the mock so the engine sees the stubbed ChatGPT module.
const { createScan, runStep } = await import('#/lib/scanner/engine')

let t: TestEnv
let f: FetchStub
beforeEach(() => {
  t = resetEnv()
  f = stubFetch()
  llm.calls.length = 0
})
afterEach(() => f.restore())

async function onboard() {
  const user = insertUser(t, { chatgpt: true })
  const repo = insertRepo(t, { id: 77, fullName: 'acme/shop', users: [{ id: user }] })
  setPreferences(t, user, { frequency: 'weekly', depth: 'standard', audience: 'developer' })
  serveRepo(f, { fullName: 'acme/shop', files: SHOP_FILES })
  serveOsv(f, LODASH_VULN)
  const understand = await createScan(user, repo, 'understand', 'onboarding')
  await drain(t, runStep)
  const security = t.db.row<{ id: string }>(`SELECT id FROM scans WHERE kind = 'security'`)!.id
  return { user, repo, understand, security }
}

test('onboarding read + security report with a stubbed LLM', async () => {
  const { understand, security } = await onboard()

  // --- both scans ran on the AI engine to completion
  for (const id of [understand, security]) {
    const row = scanRow(t, id)
    assert.deepEqual([row.status, row.progress, row.engine, row.model], ['completed', 100, 'ai', 'gpt-stub'], `scan ${row.kind}`)
  }
  assert.equal(scanRow(t, security).trigger, 'onboarding')

  // --- each agent was asked the expected number of times, at the expected effort
  assert.deepEqual(
    llm.calls.map((c) => [c.role, c.effort, c.json]),
    [
      ['reader', 'low', true],
      ['architect', 'medium', true],
      ['reviewer', 'medium', true],
      ['validator', 'high', true],
      ['validator', 'high', true],
      ['triage', 'medium', true],
    ],
  )
  const reviewer = llm.calls.find((c) => c.role === 'reviewer')!
  assert.match(reviewer.prompt, /"sensitiveAreas":\["src\/server\.ts"\]/, 'reviewer sees the profile built by the understand scan')
  assert.match(reviewer.prompt, /Q: Is the admin panel exposed to the internet\?\nA: No, only over the VPN/, 'and the answered question')
  assert.match(reviewer.prompt, /static-analyzer hint .*SQL built with string concatenation/, 'and the heuristic hints')
  assert.match(reviewer.prompt, /PRODUCT MEMORY[\s\S]*UNENFORCED: admin routes assume a reverse proxy adds auth/, 'and product memory')

  // --- understand: profile + questions
  const profile = JSON.parse(t.db.row<{ profile_json: string }>('SELECT profile_json FROM repositories WHERE id = 77')!.profile_json)
  assert.deepEqual(profile.stack, ['Node.js', 'Express'])
  assert.equal('answers' in profile, false, 'answers are applied, not stored in the profile')
  const questions = t.db.rows<{ question: string; status: string; answer_source: string | null; scan_id: string }>('SELECT question, status, answer_source, scan_id FROM questions ORDER BY created_at, question')
  assert.deepEqual(
    questions.map((q) => [q.scan_id === understand ? 'understand' : 'security', q.question, q.status, q.answer_source]),
    [
      ['understand', 'Is the admin panel exposed to the internet?', 'auto_answered', 'ai'],
      ['security', 'Is /search behind authentication?', 'open', null],
      ['security', MISSING_FACT, 'open', null],
    ],
  )

  // --- security: findings after dedupe, validation and triage
  const findings = t.db.rows<{ title: string; severity: string; status: string; priority: number; verdict: string | null; source: string; recommendation: string; verification: string | null }>(
    'SELECT * FROM findings WHERE scan_id = ? ORDER BY priority',
    security,
  )
  assert.deepEqual(
    findings.map((x) => [x.priority, x.title, x.severity, x.status, x.verdict, x.source]),
    [
      [1, SQLI, 'critical', 'open', 'confirmed', 'ai-review'],
      [2, 'lodash@4.17.15 has 1 known vulnerability', 'critical', 'open', null, 'osv'],
      [3, RATE, 'medium', 'open', 'needs_validation', 'ai-review'],
      [4, VERBOSE, 'low', 'dismissed', null, 'ai-review'],
    ],
  )
  assert.equal(findings[0].recommendation, 'Use parameterized queries', 'validator corrected the recommendation')
  assert.match(findings[2].verification!, new RegExp(`Missing fact: ${MISSING_FACT.replace(/[?/]/g, '\\$&')}`))

  // --- report summary
  const summary = JSON.parse(scanRow(t, security).summary_json!)
  assert.deepEqual(summary, {
    headline: 'Fix the SQL injection in /search before anything else.',
    riskLevel: 'critical',
    whatMatters: ['Search is injectable', 'lodash is outdated'],
    nextActions: [{ action: 'Parameterize the search query', why: 'Full database read', effort: 'small' }],
    stats: { critical: 2, high: 0, medium: 1, low: 0, info: 0 },
    filesReviewed: 4,
    dependenciesChecked: 2,
    validation: { confirmed: 1, needs_validation: 1, rejected: 0, unverified: 2 },
    needsValidation: [{ title: RATE, missingFact: MISSING_FACT }],
    memory: { skippedFiles: 0, reusedVerdicts: 0, carriedFindings: 0 },
  })
  const skills = JSON.parse(scanRow(t, security).skills_json!) as string[]
  assert.ok(skills.length > 3 && skills.includes('tob-supply-chain-risk-auditor'), 'skills used by the scan are recorded')

  // --- product memory picked up facts and verdicts
  const memory = t.db.rows<{ kind: string; content: string }>('SELECT kind, content FROM memory ORDER BY kind, content')
  assert.ok(memory.some((m) => m.kind === 'fact' && m.content === 'acme/shop: UNENFORCED: admin routes assume a reverse proxy adds auth'))
  assert.ok(memory.some((m) => m.kind === 'verdict' && m.content === `confirmed: ${SQLI}`))
  assert.equal(memory.filter((m) => m.kind === 'reviewed').length, 4)
  assertNoUnexpectedFetch(f)
})

test('a second report on unchanged code reuses product memory', async () => {
  const { user, repo, security } = await onboard()
  llm.calls.length = 0
  const again = await createScan(user, repo, 'security', 'manual')
  assert.notEqual(again, security)
  await drain(t, runStep)
  const row = scanRow(t, again)
  assert.equal(row.status, 'completed')
  const summary = JSON.parse(row.summary_json!)
  assert.deepEqual(summary.memory, { skippedFiles: 4, reusedVerdicts: 0, carriedFindings: 2 })
  assert.deepEqual(
    llm.calls.map((c) => c.role),
    ['triage'],
    'no file is re-reviewed and nothing new (carried findings included) needs validating',
  )
  assert.match(llm.calls[0].system, /triage lead/)
  // The validator-confirmed critical and the open needs_validation finding are carried with their
  // verdicts; the finding triage dismissed in the first report stays out.
  const findings = t.db.rows<{ title: string; severity: string; status: string; verdict: string | null; carried_from: string | null }>(
    'SELECT title, severity, status, verdict, carried_from FROM findings WHERE scan_id = ? ORDER BY priority',
    again,
  )
  assert.deepEqual(
    findings.map((x) => [x.title, x.severity, x.status, x.verdict, x.carried_from]),
    [
      [SQLI, 'critical', 'open', 'confirmed', security],
      ['lodash@4.17.15 has 1 known vulnerability', 'critical', 'open', null, null],
      [RATE, 'medium', 'open', 'needs_validation', security],
    ],
  )
  assert.deepEqual(summary.stats, { critical: 2, high: 0, medium: 1, low: 0, info: 0 })
  assert.deepEqual(summary.needsValidation, [{ title: RATE, missingFact: MISSING_FACT }])
  const { listFindings } = await import('#/lib/queries')
  assert.deepEqual(
    (await listFindings(user)).map((x) => [x.scan_id, x.title]),
    [
      [again, SQLI],
      [again, 'lodash@4.17.15 has 1 known vulnerability'],
      [again, RATE],
    ],
    'the latest report keeps the confirmed critical',
  )
  assertNoUnexpectedFetch(f)
})
