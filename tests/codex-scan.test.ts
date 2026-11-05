/**
 * The scan state machine on the Codex Cloud engine, against a fake Codex Cloud
 * (tests/helpers/codex.ts) served over the fetch stub. The real Codex client, prompts,
 * task-output contract, agent tokens and engine run; only Codex's (and, for triage and
 * fallbacks, ChatGPT's) answers are scripted.
 *
 *   understand:  init -> codex_recon -> codex_recon_wait* -> done
 *   security:    init -> deps -> codex_hunt -> codex_hunt_wait* -> codex_validate -> codex_validate_wait* -> triage -> done
 *
 * plus every way out of the Codex path: failed task, invalid output, timeout, Codex API
 * errors, no environment, and the cron reviving a scan that waits on a live task.
 */
import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { CODEX_ACCESS_TOKEN, CODEX_ACCOUNT_ID, mockChatGPT, type LlmCall } from './helpers/llm.ts'
import { FakeCodex, done, failed, pending, running, type Poll } from './helpers/codex.ts'
import {
  APP_URL,
  assertNoUnexpectedFetch,
  events,
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

// ---------------------------------------------------------------- scripted answers

const SQLI = 'SQL injection in /search handler'
const RATE = 'Login has no rate limiting'
const LOGS = 'Request bodies are logged'

const RECON = {
  summary: 'A storefront API',
  stack: ['Node.js', 'Express'],
  entryPoints: ['src/server.ts'],
  dataStores: ['PostgreSQL'],
  auth: 'Static API key in src/auth.ts',
  externalServices: ['Stripe'],
  deployment: 'Unknown',
  sensitiveAreas: ['src/server.ts'],
  notes: ['The search endpoint is public'],
  answers: [],
  questions: [{ question: 'Is the admin panel exposed to the internet?', rationale: 'Changes the severity of admin findings' }],
  memoryApi: 'used',
}

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

const HUNT = {
  findings: [finding({ severity: 'high', title: SQLI }), finding({ title: RATE, file: 'src/auth.ts', line: 2 }), finding({ severity: 'low', title: LOGS, line: 5 })],
  questions: [{ question: 'Is /search behind authentication?', rationale: 'Decides exposure' }],
  answers: [],
  filesExamined: 7,
  // A path the tree doesn't have is not remembered as reviewed.
  reviewedPaths: ['src/server.ts', 'src/auth.ts', 'src/ghost.ts'],
  memoryApi: 'used',
}

const verdict = (index: number, decision: 'confirmed' | 'rejected' | 'needs_validation', severity = 'medium') => ({
  index,
  restatedClaim: 'claim',
  gates: { reachability: 'pass', realImpact: 'pass', noPreventingControl: 'pass', environment: 'unknown' },
  brocardFailed: decision === 'rejected' ? 3 : 0,
  decision,
  severity,
  reasoning: decision === 'rejected' ? 'a rate limiter is configured in src/server.ts' : 'traced it end to end',
  missingFact: '',
  correctedRecommendation: decision === 'confirmed' ? 'Use parameterized queries' : '',
})

// Validation order is severity first: #0 = the SQLi (high), #1 = rate limiting (medium).
const VALIDATE = { verdicts: [verdict(0, 'confirmed', 'critical'), verdict(1, 'rejected')], memoryApi: 'not_needed' }

/** ChatGPT: only triage runs on it while Codex works; the direct agents answer after a fallback. */
function respond(call: LlmCall): unknown {
  switch (call.role) {
    case 'triage': {
      const ranking = [...call.prompt.matchAll(/^#(\d+) \[(\w+)\//gm)].map(([, index, severity], i) => ({ index: Number(index), priority: i + 1, severity, falsePositive: false }))
      return { headline: 'Fix the SQL injection first.', riskLevel: 'critical', whatMatters: ['Search is injectable'], nextActions: [{ action: 'Parameterize', why: 'DB read', effort: 'small' }], ranking, research: [] }
    }
    case 'reader':
      return { notes: ['Express server'], questions: [], answers: [] }
    case 'architect':
      return { ...RECON, questions: undefined, memoryApi: undefined }
    case 'reviewer':
      return { findings: [finding({ severity: 'high', title: `${SQLI} (direct)` })], questions: [], answers: [] }
    case 'validator': {
      const { index: _i, ...v } = verdict(0, 'confirmed', 'high')
      return v
    }
    default:
      throw new Error(`unexpected LLM call: ${call.system.slice(0, 80)}`)
  }
}

const llm = mockChatGPT(respond, { codex: true })
// Loaded after the mock so the engine sees the stubbed ChatGPT module.
const { createScan, runStep, reviveStalledScans } = await import('#/lib/scanner/engine')

// ---------------------------------------------------------------- harness

let t: TestEnv
let f: FetchStub
let codex: FakeCodex
beforeEach(() => {
  t = resetEnv()
  f = stubFetch()
  codex = new FakeCodex(f, { 'acme/shop': [{ id: 'env_other', label: 'old', task_count: 1 }, { id: 'env_1', label: 'shop env', is_pinned: true }] })
  llm.calls.length = 0
})
afterEach(() => f.restore())

type Step = [kind: string, phase: string, progress: number, delay?: number]

/** Drains the queue like the consumer, recording each scan's phase/progress after every step and the delay it asked for. */
async function run(maxSteps = 100): Promise<Step[]> {
  const steps: Step[] = []
  while (t.queue.length) {
    assert.ok(steps.length < maxSteps, 'queue did not drain')
    const { scanId } = t.queue.shift()!
    const before = t.queue.length
    await runStep(scanId)
    const row = scanRow(t, scanId)
    const own = t.queue.slice(before).find((j) => j.scanId === scanId)
    steps.push(own?.delaySeconds ? [row.kind, row.phase, row.progress, own.delaySeconds] : [row.kind, row.phase, row.progress])
  }
  return steps
}

/** Runs queued steps until `scanId` reaches `phase` (the rest stays queued). */
async function runUntil(scanId: string, phase: string) {
  for (let i = 0; i < 50 && scanRow(t, scanId).phase !== phase; i++) {
    const j = t.queue.findIndex((x) => x.scanId === scanId)
    assert.ok(j >= 0, `scan stopped before reaching ${phase} (at ${scanRow(t, scanId).phase})`)
    t.queue.splice(j, 1)
    await runStep(scanId)
  }
  assert.equal(scanRow(t, scanId).phase, phase)
}

function setup(prefs: Record<string, unknown> = {}) {
  const user = insertUser(t, { chatgpt: true })
  const repo = insertRepo(t, { id: 77, fullName: 'acme/shop', users: [{ id: user }] })
  setPreferences(t, user, { frequency: 'weekly', depth: 'standard', audience: 'developer', ...prefs })
  serveRepo(f, { fullName: 'acme/shop', files: SHOP_FILES })
  serveOsv(f, LODASH_VULN)
  return { user, repo }
}

const securityId = () => t.db.row<{ id: string }>(`SELECT id FROM scans WHERE kind = 'security'`)!.id
const findings = (scanId: string) =>
  t.db.rows<{ title: string; severity: string; status: string; verdict: string | null; source: string; recommendation: string }>(
    'SELECT title, severity, status, verdict, source, recommendation FROM findings WHERE scan_id = ? ORDER BY title',
    scanId,
  )
const warnings = (scanId: string) => events(t, scanId).filter((e) => e.level !== 'info').map((e) => e.message)

// ---------------------------------------------------------------- the happy path

describe('Codex engine: full state machine', () => {
  test('onboarding read and security report run as Codex tasks, step by step', async () => {
    const { user, repo } = setup()
    codex
      .script('recon', pending, running, done(RECON, ['Reading the repository…']))
      // Codex sometimes ends with chatter after the JSON: the last message that fits the contract wins.
      .script('hunt', running, running, done(HUNT), done(HUNT))
      .script('validate', done(VALIDATE))
    const understand = await createScan(user, repo, 'understand', 'onboarding')
    const steps = await run()

    // --- the exact path through both state machines, with the 30 s Codex poll delay
    assert.deepEqual(steps, [
      ['understand', 'codex_recon', 10],
      ['understand', 'codex_recon_wait', 15, 30],
      ['understand', 'codex_recon_wait', 15, 30], // pending
      ['understand', 'codex_recon_wait', 15, 30], // in_progress
      ['understand', 'done', 100], // completed → the onboarding security report is queued
      ['security', 'deps', 8],
      ['security', 'codex_hunt', 18],
      ['security', 'codex_hunt_wait', 22, 30],
      ['security', 'codex_hunt_wait', 22, 30],
      ['security', 'codex_hunt_wait', 22, 30],
      ['security', 'codex_validate', 76], // hunt done: 2 serious findings to validate
      ['security', 'codex_validate_wait', 78, 30],
      ['security', 'triage', 88],
      ['security', 'done', 100],
    ])
    const security = securityId()
    for (const id of [understand, security]) {
      const row = scanRow(t, id)
      assert.deepEqual([row.status, row.engine, row.model, row.attempts, row.lease_id], ['completed', 'codex', 'codex-cloud', 0, null], row.kind)
    }

    // --- one task per role, in the pinned environment, in Ask mode, with the user's ChatGPT credentials
    assert.deepEqual(
      codex.tasks.map((x) => [x.role, x.environmentId, x.branch, x.qaMode, x.headers.authorization, x.headers.account, x.polls]),
      [
        ['recon', 'env_1', 'main', true, `Bearer ${CODEX_ACCESS_TOKEN}`, CODEX_ACCOUNT_ID, 3],
        ['hunt', 'env_1', 'main', true, `Bearer ${CODEX_ACCESS_TOKEN}`, CODEX_ACCOUNT_ID, 3],
        ['validate', 'env_1', 'main', true, `Bearer ${CODEX_ACCESS_TOKEN}`, CODEX_ACCOUNT_ID, 1],
      ],
    )
    assert.deepEqual(codex.envLookups, ['acme/shop'], 'the environment is looked up once and cached for the next scan')
    assert.deepEqual(t.db.row('SELECT codex_env_id, codex_env_label FROM user_repositories WHERE repo_id = 77'), { codex_env_id: 'env_1', codex_env_label: 'shop env' })

    // --- what each task was told
    const hunt = codex.task('hunt').prompt
    assert.match(hunt, /"sensitiveAreas":\["src\/server\.ts"\]|src\/server\.ts/, 'the hunt sees the profile from recon')
    assert.match(hunt, /Is the admin panel exposed to the internet\?/, 'and the open question recon raised')
    assert.match(hunt, new RegExp(`${APP_URL.replace(/[.]/g, '\\.')}/api/agent`), 'and how to reach the product memory API')
    const validate = codex.task('validate').prompt
    assert.ok(validate.indexOf(SQLI) < validate.indexOf(RATE), 'findings to validate, most severe first')
    assert.ok(!validate.includes(LOGS), 'low findings are not validated')

    // --- ChatGPT only did the triage; Codex did the reading, hunting and validation
    assert.deepEqual(llm.calls.map((c) => c.role), ['triage'])

    // --- results: recon profile + question, hunt findings with Codex's verdicts applied
    const profile = JSON.parse(t.db.row<{ profile_json: string }>('SELECT profile_json FROM repositories WHERE id = 77')!.profile_json)
    assert.deepEqual([profile.summary, profile.stack], ['A storefront API', ['Node.js', 'Express']])
    assert.deepEqual(
      findings(security).map((x) => [x.title, x.severity, x.status, x.verdict, x.source]),
      [
        [RATE, 'medium', 'dismissed', 'rejected', 'ai-review'],
        [LOGS, 'low', 'open', null, 'ai-review'],
        [SQLI, 'critical', 'open', 'confirmed', 'ai-review'],
        ['lodash@4.17.15 has 1 known vulnerability', 'critical', 'open', null, 'osv'],
      ],
    )
    assert.equal(findings(security).find((x) => x.title === SQLI)!.recommendation, 'Use parameterized queries')
    assert.deepEqual(
      t.db.rows<{ question: string }>('SELECT question FROM questions ORDER BY created_at').map((q) => q.question),
      ['Is the admin panel exposed to the internet?', 'Is /search behind authentication?'],
    )
    const summary = JSON.parse(scanRow(t, security).summary_json!)
    assert.equal(summary.headline, 'Fix the SQL injection first.')
    assert.equal(summary.filesReviewed, 7, "Codex's own count of files it read")

    // --- task list shown on the report, and memory of reviewed files (only paths in the tree)
    assert.deepEqual(
      JSON.parse(t.db.row<{ codex_tasks_json: string }>('SELECT codex_tasks_json FROM scans WHERE id = ?', security)!.codex_tasks_json).map((x: { role: string; status: string }) => [x.role, x.status]),
      [
        ['hunt', 'completed'],
        ['validate', 'completed'],
      ],
    )
    const reviewed = t.db.rows<{ key: string }>(`SELECT key FROM memory WHERE kind = 'reviewed' ORDER BY key`).map((m) => m.key.slice(m.key.indexOf(':') + 1))
    assert.deepEqual(reviewed, ['src/auth.ts', 'src/server.ts'])

    // --- each task got its own memory-API token, revoked when the task ended
    const tokens = t.db.rows<{ purpose: string; task_id: string; revoked_at: number | null; scan_id: string }>('SELECT purpose, task_id, revoked_at, scan_id FROM agent_tokens ORDER BY created_at')
    assert.deepEqual(
      tokens.map((x) => [x.purpose, x.task_id, x.scan_id === understand ? 'understand' : 'security', x.revoked_at !== null]),
      [
        ['recon', 'task_recon_1', 'understand', true],
        ['hunt', 'task_hunt_2', 'security', true],
        ['validate', 'task_validate_3', 'security', true],
      ],
    )
    assert.deepEqual([...warnings(understand), ...warnings(security)], [])
    assertNoUnexpectedFetch(f)
  })

  test('no serious findings: the hunt goes straight to triage, without a validate task', async () => {
    const { user, repo } = setup({ dependencyChecks: false })
    codex.script('hunt', done({ ...HUNT, findings: [finding({ severity: 'low', title: LOGS })] }))
    t.db.write(`UPDATE repositories SET profile_json = ?, understood_at = ? WHERE id = 77`, JSON.stringify(RECON), Date.now())
    const id = await createScan(user, repo, 'security', 'manual')
    const steps = await run()
    assert.deepEqual(
      steps.map(([, phase]) => phase),
      ['deps', 'codex_hunt', 'codex_hunt_wait', 'triage', 'done'],
    )
    assert.deepEqual(codex.tasks.map((x) => x.role), ['hunt'])
    assert.equal(scanRow(t, id).status, 'completed')
  })
})

// ---------------------------------------------------------------- ways out of the Codex path

describe('Codex engine: fallbacks to direct ChatGPT', () => {
  async function securityScan(huntScript: Poll[], validateScript: Poll[] = [done(VALIDATE)]) {
    const { user, repo } = setup()
    t.db.write(`UPDATE repositories SET profile_json = ?, understood_at = ? WHERE id = 77`, JSON.stringify(RECON), Date.now())
    codex.script('hunt', ...huntScript).script('validate', ...validateScript)
    return createScan(user, repo, 'security', 'manual')
  }

  test('a failed hunt task: the scan switches to the AI engine and finishes with the direct reviewer', async () => {
    const id = await securityScan([running, failed('environment setup failed')])
    const steps = await run()
    assert.deepEqual(
      steps.map(([, phase]) => phase),
      ['deps', 'codex_hunt', 'codex_hunt_wait', 'codex_hunt_wait', 'review', 'review', 'validate', 'triage', 'done'],
    )
    const row = scanRow(t, id)
    assert.deepEqual([row.status, row.engine], ['completed', 'ai'])
    assert.deepEqual(llm.calls.map((c) => c.role), ['reviewer', 'validator', 'triage'])
    assert.ok(warnings(id).some((m) => /Codex Cloud: hunt task failed: env_error: environment setup failed — falling back to direct ChatGPT review/.test(m)))
    assert.deepEqual(findings(id).find((x) => x.title.endsWith('(direct)'))?.verdict, 'confirmed')
    assert.equal(t.db.row<{ revoked: number }>('SELECT COUNT(*) AS revoked FROM agent_tokens WHERE revoked_at IS NOT NULL')!.revoked, 1, 'the task token is revoked')
  })

  test('a hunt that finishes without output matching the contract falls back', async () => {
    const id = await securityScan([done('I looked around and everything seems fine!', ['{"not": "the contract"}'])])
    await run()
    assert.equal(scanRow(t, id).engine, 'ai')
    assert.ok(warnings(id).some((m) => /hunt task finished without valid JSON output/.test(m)))
  })

  test('a task still running after 45 minutes times out and falls back', async () => {
    const id = await securityScan([running])
    await runUntil(id, 'codex_hunt_wait')
    // The task started 46 minutes ago.
    const state = JSON.parse(scanRow(t, id).state_json)
    state.codex.tasks.hunt.startedAt = Date.now() - 46 * 60_000
    t.db.write('UPDATE scans SET state_json = ? WHERE id = ?', JSON.stringify(state), id)
    await run()
    assert.deepEqual([scanRow(t, id).status, scanRow(t, id).engine], ['completed', 'ai'])
    assert.ok(warnings(id).some((m) => /hunt task timed out/.test(m)))
    assert.equal(codex.task('hunt').polls, 1, 'the first poll past the deadline gives up')
  })

  test('an unknown task status keeps waiting (until the timeout)', async () => {
    const id = await securityScan([{ status: 'weird' }, { status: 'weird' }, done(HUNT)])
    const steps = await run()
    assert.deepEqual(
      steps.map(([, phase]) => phase).slice(0, 6),
      ['deps', 'codex_hunt', 'codex_hunt_wait', 'codex_hunt_wait', 'codex_hunt_wait', 'codex_validate'],
    )
    assert.equal(scanRow(t, id).engine, 'codex')
  })

  test('Codex refusing to create the task falls back without a stray token', async () => {
    const id = await securityScan([done(HUNT)])
    codex.createStatus = 502
    await run()
    assert.equal(scanRow(t, id).engine, 'ai')
    assert.ok(warnings(id).some((m) => /Codex Cloud POST \/wham\/tasks → 502/.test(m)))
    assert.equal(t.db.row<{ live: number }>('SELECT COUNT(*) AS live FROM agent_tokens WHERE revoked_at IS NULL')!.live, 0)
  })

  test('a failed validate task keeps the hunt findings and validates them directly', async () => {
    const id = await securityScan([done(HUNT)], [failed()])
    const steps = await run()
    assert.deepEqual(
      steps.map(([, phase]) => phase),
      ['deps', 'codex_hunt', 'codex_hunt_wait', 'codex_validate', 'codex_validate_wait', 'validate', 'triage', 'done'],
    )
    assert.deepEqual(llm.calls.map((c) => c.role), ['validator', 'validator', 'triage'], 'each queued finding gets the direct validator')
    assert.deepEqual(
      findings(id).filter((x) => x.source === 'ai-review').map((x) => [x.title, x.verdict]),
      [
        [RATE, 'confirmed'],
        [LOGS, null],
        [SQLI, 'confirmed'],
      ],
    )
  })

  test('no Codex environment for the repo: the direct AI engine, and no task is created', async () => {
    codex.environments['acme/shop'] = []
    const { user, repo } = setup()
    const id = await createScan(user, repo, 'security', 'manual')
    await run()
    const row = scanRow(t, id)
    assert.deepEqual([row.status, row.engine, row.model], ['completed', 'ai', 'gpt-stub'])
    assert.deepEqual(codex.tasks, [])
    assert.ok(events(t, id).some((e) => /No Codex Cloud environment for acme\/shop/.test(e.message)))
  })

  test('ChatGPT unlinked mid-scan: the Codex scan continues on heuristics', async () => {
    const id = await securityScan([running, done(HUNT)])
    await runUntil(id, 'codex_hunt_wait')
    t.db.write('UPDATE users SET chatgpt_cookie_enc = NULL')
    await run()
    assert.deepEqual([scanRow(t, id).status, scanRow(t, id).engine], ['completed', 'heuristic'])
    assert.ok(warnings(id).some((m) => /ChatGPT session unavailable — continuing with heuristics/.test(m)))
  })
})

// ---------------------------------------------------------------- cron + Codex wait

describe('Codex engine: the cron and a scan waiting on Codex', () => {
  test('a stalled scan polling a live task is revived without using attempts, and then completes', async () => {
    const { user, repo } = setup()
    t.db.write(`UPDATE repositories SET profile_json = ?, understood_at = ? WHERE id = 77`, JSON.stringify(RECON), Date.now())
    codex.script('hunt', running, running, done(HUNT)).script('validate', done(VALIDATE))
    const id = await createScan(user, repo, 'security', 'manual')
    await runUntil(id, 'codex_hunt_wait')
    t.queue.length = 0 // the next poll's queue message is lost
    // One poll has recorded the task as in_progress; the worker then went quiet for 11 minutes, three times.
    for (let i = 0; i < 3; i++) {
      t.db.write('UPDATE scans SET updated_at = ? WHERE id = ?', Date.now() - 11 * 60_000, id)
      await reviveStalledScans()
      assert.deepEqual(t.queue, [{ scanId: id }])
      assert.equal(scanRow(t, id).attempts, 0)
      if (i < 2) t.queue.length = 0
    }
    await run()
    assert.deepEqual([scanRow(t, id).status, scanRow(t, id).engine], ['completed', 'codex'])
  })

  test('a stalled scan whose last poll saw an unknown task state uses attempts (the poll records what it saw)', async () => {
    const { user, repo } = setup()
    t.db.write(`UPDATE repositories SET profile_json = ?, understood_at = ? WHERE id = 77`, JSON.stringify(RECON), Date.now())
    codex.script('hunt', { status: 'weird' })
    const id = await createScan(user, repo, 'security', 'manual')
    await runUntil(id, 'codex_hunt_wait') // creates the task ("running")
    t.queue.splice(t.queue.findIndex((j) => j.scanId === id), 1)
    await runStep(id) // first poll: Codex answers with a status the client doesn't know
    assert.equal(JSON.parse(scanRow(t, id).state_json).codex.tasks.hunt.status, 'unknown')
    t.queue.length = 0
    t.db.write('UPDATE scans SET updated_at = ? WHERE id = ?', Date.now() - 11 * 60_000, id)
    await reviveStalledScans()
    assert.equal(scanRow(t, id).attempts, 1)
  })

  test('a stalled scan whose Codex task is past the timeout uses attempts like any stuck step', async () => {
    const { user, repo } = setup()
    t.db.write(`UPDATE repositories SET profile_json = ?, understood_at = ? WHERE id = 77`, JSON.stringify(RECON), Date.now())
    codex.script('hunt', running)
    const id = await createScan(user, repo, 'security', 'manual')
    await runUntil(id, 'codex_hunt_wait')
    t.queue.length = 0
    const state = JSON.parse(scanRow(t, id).state_json)
    state.codex.tasks.hunt.startedAt = Date.now() - 50 * 60_000
    t.db.write('UPDATE scans SET state_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(state), Date.now() - 11 * 60_000, id)
    await reviveStalledScans()
    assert.equal(scanRow(t, id).attempts, 1)
  })
})
