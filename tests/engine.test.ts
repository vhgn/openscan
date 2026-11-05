/** The scan state machine (src/lib/scanner/engine.ts) against an in-memory D1 and stubbed GitHub/OSV. */
import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createScan, runStep, scheduledTick, startProductScan } from '#/lib/scanner/engine'
import { saveProduct } from '#/lib/products'
import {
  assertNoUnexpectedFetch,
  drain,
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

let t: TestEnv
let f: FetchStub
beforeEach(() => {
  t = resetEnv()
  f = stubFetch()
})
afterEach(() => f.restore())

/** Runs exactly the queued step for `scanId` and returns the row afterwards. */
async function step(scanId: string) {
  const next = t.queue.shift()
  assert.equal(next?.scanId, scanId, 'expected the scan to have exactly one queued step')
  await runStep(scanId)
  return scanRow(t, scanId)
}

describe('createScan', () => {
  test('queues a scan: row, event and one queue message', async () => {
    const user = insertUser(t)
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    const id = await createScan(user, repo, 'security', 'manual', { diff: { base: 'a', head: 'b' } })
    const row = scanRow(t, id)
    assert.equal(row.status, 'queued')
    assert.equal(row.phase, 'queued')
    assert.equal(row.progress, 0)
    assert.equal(row.trigger, 'manual')
    assert.deepEqual(JSON.parse(row.state_json), { diff: { base: 'a', head: 'b' } })
    assert.deepEqual(t.queue, [{ scanId: id }])
    assert.match(events(t, id)[0].message, /Queued security scan \(manual\)/)
  })

  test('dedupes while a scan of the same kind is queued or running', async () => {
    const user = insertUser(t)
    const other = insertUser(t)
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }, { id: other }] })
    const a = await createScan(user, repo, 'security', 'manual')
    assert.equal(await createScan(user, repo, 'security', 'schedule'), a, 'queued scan is reused')
    t.db.write(`UPDATE scans SET status = 'running' WHERE id = ?`, a)
    assert.equal(await createScan(user, repo, 'security', 'push'), a, 'running scan is reused')
    assert.equal(t.queue.length, 1, 'no extra queue message for a deduped scan')

    const understand = await createScan(user, repo, 'understand', 'onboarding')
    assert.notEqual(understand, a, 'a different kind is a different scan')
    const otherUsers = await createScan(other, repo, 'security', 'manual')
    assert.notEqual(otherUsers, a, "another user's scan of the same repo is independent")

    for (const status of ['completed', 'failed']) {
      t.db.write(`UPDATE scans SET status = ? WHERE id = ?`, status, a)
      const next = await createScan(user, repo, 'security', 'manual')
      assert.notEqual(next, a, `a ${status} scan does not block a new one`)
      t.db.write(`UPDATE scans SET status = 'completed' WHERE id = ?`, next)
    }
  })

  test("records the repository's product", async () => {
    const user = insertUser(t)
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    const product = await saveProduct(user, { name: 'Shop', repoIds: [repo] })
    assert.equal(scanRow(t, await createScan(user, repo, 'security', 'manual')).product_id, product)
  })
})

describe('startProductScan', () => {
  test('one product scan owning a repository scan per linked member repo', async () => {
    const user = insertUser(t)
    const other = insertUser(t)
    insertRepo(t, { id: 1, fullName: 'acme/api', users: [{ id: user }] })
    insertRepo(t, { id: 2, fullName: 'acme/web', users: [{ id: user }] })
    insertRepo(t, { id: 3, fullName: 'acme/gone', installationId: 30, users: [{ id: user }] })
    insertRepo(t, { id: 4, fullName: 'acme/theirs', users: [{ id: other }] })
    t.db.write('UPDATE repositories SET removed_at = ? WHERE id = 3', Date.now())
    const product = await saveProduct(user, { name: 'Acme', repoIds: [1, 2, 3, 4] })

    const started = (await startProductScan(user, product, 'manual'))!
    assert.ok(started.id)
    assert.equal(started.scanIds.length, 2, 'detached repos and repos the user does not have are skipped')
    assert.deepEqual(
      started.scanIds.map((id) => scanRow(t, id)).map((s) => [s.kind, s.trigger, s.product_id, s.product_scan_id]),
      [
        ['security', 'manual', product, started.id],
        ['security', 'manual', product, started.id],
      ],
    )
    assert.equal(t.queue.length, 2)

    // Only some repos (a push): non-members are ignored.
    const again = await startProductScan(user, product, 'push', { repoIds: [2, 99] })
    assert.deepEqual(again, { id: started.id, scanIds: [started.scanIds[1]] }, 'a repo already being scanned keeps its running scan and product scan')
    assert.equal(t.db.row<{ n: number }>('SELECT COUNT(*) AS n FROM product_scans')!.n, 1, 'no empty product scan is left behind')
    assert.equal(await startProductScan(user, product, 'push', { repoIds: [99] }), null)
  })
})

describe('runStep: understand (heuristic engine)', () => {
  test('init -> read -> profile -> done, then the onboarding security scan', async () => {
    const user = insertUser(t)
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    serveRepo(f, { fullName: 'acme/shop', files: SHOP_FILES })
    const id = await createScan(user, repo, 'understand', 'onboarding')

    let row = await step(id)
    assert.equal(row.status, 'running')
    assert.ok(row.started_at)
    assert.equal(row.engine, 'heuristic')
    assert.equal(row.phase, 'read')
    assert.equal(row.progress, 10)
    assert.equal(row.commit_sha, 'c0ffee0000000000000000000000000000000001')
    const state = JSON.parse(row.state_json)
    assert.deepEqual([...state.files].sort(), ['README.md', 'package.json', 'src/auth.ts', 'src/server.ts'])
    assert.deepEqual(state.lockfiles.sort(), ['package-lock.json', 'package.json'])
    // Heuristic questions; the auth one is self-answered because src/auth.ts exists.
    const qs = t.db.rows<{ question: string; status: string }>('SELECT question, status FROM questions WHERE scan_id = ? ORDER BY question', id)
    assert.equal(qs.length, 3)
    assert.deepEqual(qs.find((q) => /authenticated/.test(q.question))?.status, 'auto_answered')

    row = await step(id)
    assert.deepEqual([row.phase, row.progress], ['read', 85])
    assert.equal(JSON.parse(row.state_json).cursor, 4)

    row = await step(id)
    assert.deepEqual([row.phase, row.progress], ['profile', 88])

    row = await step(id)
    assert.equal(row.status, 'completed')
    assert.equal(row.progress, 100)
    assert.ok(row.finished_at)
    const summary = JSON.parse(row.summary_json!)
    assert.equal(summary.filesReviewed, 4)
    assert.equal(summary.openQuestions, 2)
    assert.ok(summary.profile.stack.includes('Node.js'))
    const repoRow = t.db.row<{ profile_json: string; understood_at: number }>('SELECT profile_json, understood_at FROM repositories WHERE id = 1')!
    assert.ok(repoRow.understood_at)
    assert.deepEqual(JSON.parse(repoRow.profile_json), summary.profile)
    assert.equal(events(t, id).at(-1)!.message, 'Done')

    // Onboarded user without a security report gets one automatically.
    assert.equal(t.queue.length, 1)
    const security = scanRow(t, t.queue[0].scanId)
    assert.deepEqual([security.kind, security.trigger, security.status], ['security', 'onboarding', 'queued'])
    // ...inside an onboarding product scan of the default product the reading created (named after the owner).
    const ps = t.db.row<{ trigger: string; name: string }>('SELECT ps.trigger, p.name FROM product_scans ps JOIN products p ON p.id = ps.product_id WHERE ps.id = ?', security.product_scan_id)
    assert.deepEqual(ps, { trigger: 'onboarding', name: 'acme' })
    assertNoUnexpectedFetch(f)
  })

  test('no automatic security scan before onboarding is finished', async () => {
    const user = insertUser(t, { onboarded: false })
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    serveRepo(f, { fullName: 'acme/shop', files: SHOP_FILES })
    const id = await createScan(user, repo, 'understand', 'onboarding')
    await drain(t, runStep)
    assert.equal(scanRow(t, id).status, 'completed')
    assert.equal(t.db.row<{ n: number }>(`SELECT COUNT(*) AS n FROM scans WHERE kind = 'security'`)!.n, 0)
  })
})

describe('runStep: security (heuristic engine)', () => {
  test('init -> deps -> review -> triage -> done with findings and a summary', async () => {
    const user = insertUser(t)
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    serveRepo(f, { fullName: 'acme/shop', files: SHOP_FILES })
    serveOsv(f, LODASH_VULN)
    const id = await createScan(user, repo, 'security', 'manual')
    const phases: Array<[string, number]> = []
    while (t.queue.length) {
      const row = await step(id)
      phases.push([row.phase, row.progress])
    }
    assert.deepEqual(phases, [
      ['deps', 8],
      ['review', 18],
      ['review', 75],
      ['triage', 88],
      ['done', 100],
    ])
    const row = scanRow(t, id)
    assert.equal(row.status, 'completed')
    const findings = t.db.rows<{ title: string; source: string; severity: string; priority: number }>('SELECT title, source, severity, priority FROM findings WHERE scan_id = ? ORDER BY priority', id)
    assert.deepEqual(
      findings.map((x) => [x.priority, x.severity, x.source, x.title]),
      [
        [1, 'critical', 'osv', 'lodash@4.17.15 has 1 known vulnerability'],
        [2, 'high', 'heuristic', 'Hard-coded credential-like value'],
        [3, 'high', 'heuristic', 'SQL built with string concatenation/interpolation'],
        [4, 'medium', 'heuristic', 'Dynamic code evaluation'],
      ],
    )
    const summary = JSON.parse(row.summary_json!)
    assert.equal(summary.dependenciesChecked, 2)
    assert.equal(summary.filesReviewed, 4)
    assert.ok(JSON.parse(row.skills_json!).includes('tob-supply-chain-risk-auditor'))
    assertNoUnexpectedFetch(f)
  })

  test('push scans review the files changed in the pushed range first', async () => {
    const user = insertUser(t)
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    serveRepo(f, { fullName: 'acme/shop', files: SHOP_FILES })
    f.on('GET', `https://api.github.com/repos/acme/shop/compare/${'b'.repeat(40)}...${'a'.repeat(40)}`, () =>
      Response.json({ files: [{ filename: 'src/auth.ts', status: 'modified' }, { filename: 'old.ts', status: 'removed' }, { filename: 'gone.ts', status: 'added' }] }),
    )
    const id = await createScan(user, repo, 'security', 'push', { diff: { base: 'b'.repeat(40), head: 'a'.repeat(40) } })
    const state = JSON.parse((await step(id)).state_json)
    assert.deepEqual(state.changed, ['src/auth.ts'], 'removed files and files missing from the tree are dropped')
    assert.equal(state.files[0], 'src/auth.ts')
    assert.ok(state.skills.includes('tob-differential-review'))
    assertNoUnexpectedFetch(f)
  })

  test('OSV outages are logged as a warning, not a failed scan', async () => {
    const user = insertUser(t)
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    serveRepo(f, { fullName: 'acme/shop', files: SHOP_FILES })
    f.on('POST', 'https://api.osv.dev/v1/querybatch', () => new Response('down', { status: 503 }))
    const id = await createScan(user, repo, 'security', 'manual')
    await drain(t, runStep)
    assert.equal(scanRow(t, id).status, 'completed')
    assert.ok(events(t, id).some((e) => e.level === 'warn' && /OSV lookup failed/.test(e.message)))
  })
})

describe('runStep: retries and failure', () => {
  test('a failing step is retried with backoff, then the scan fails after 3 attempts', async () => {
    const user = insertUser(t)
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    f.on('GET', /^https:\/\/api\.github\.com\//, () => new Response('boom', { status: 500 }))
    const id = await createScan(user, repo, 'security', 'manual')

    t.queue.shift()
    await runStep(id)
    let row = scanRow(t, id)
    assert.deepEqual([row.status, row.phase, row.attempts], ['running', 'queued', 1])
    assert.deepEqual(t.queue, [{ scanId: id, delaySeconds: 10 }])

    t.queue.shift()
    await runStep(id)
    row = scanRow(t, id)
    assert.equal(row.attempts, 2)
    assert.deepEqual(t.queue, [{ scanId: id, delaySeconds: 20 }])

    t.queue.shift()
    await runStep(id)
    row = scanRow(t, id)
    assert.equal(row.status, 'failed')
    assert.match(row.error!, /GitHub 500/)
    assert.ok(row.finished_at)
    assert.deepEqual(t.queue, [], 'a failed scan is not re-enqueued')
    const log = events(t, id)
    assert.deepEqual(
      log.filter((e) => e.level === 'error').map((e) => e.message.replace(/: .*/, '')),
      ['Step "queued" failed (attempt 1/3)', 'Step "queued" failed (attempt 2/3)', 'Step "queued" failed (attempt 3/3)', 'Scan failed'],
    )

    // Terminal scans are left alone (duplicate/late queue deliveries are harmless).
    await runStep(id)
    assert.equal(events(t, id).length, log.length)
  })

  test('a successful step resets the attempt counter', async () => {
    const user = insertUser(t)
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    let fail = true
    serveRepo(f, { fullName: 'acme/shop', files: SHOP_FILES })
    f.on('GET', 'https://api.github.com/repos/acme/shop/git/ref/heads/main', () =>
      fail ? new Response('flaky', { status: 502 }) : Response.json({ object: { sha: 'c0ffee0000000000000000000000000000000001' } }),
    )
    const id = await createScan(user, repo, 'security', 'manual')
    t.queue.shift()
    await runStep(id)
    assert.equal(scanRow(t, id).attempts, 1)
    fail = false
    t.queue.shift()
    await runStep(id)
    const row = scanRow(t, id)
    assert.deepEqual([row.phase, row.attempts], ['deps', 0])
  })

  test('unknown scans are ignored; a scan of a repository removed from the app fails', async () => {
    await runStep('does-not-exist')
    const user = insertUser(t)
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', installationId: 10, users: [{ id: user }] })
    const id = await createScan(user, repo, 'security', 'manual')
    t.queue.length = 0
    t.db.write('UPDATE repositories SET removed_at = ? WHERE id = 1', Date.now())
    await runStep(id)
    const row = scanRow(t, id)
    assert.equal(row.status, 'failed')
    assert.equal(row.error, 'acme/shop was removed from the GitHub App')
    assert.deepEqual(t.queue, [])
    assert.equal(t.db.row<{ lease_id: string | null }>('SELECT lease_id FROM scans WHERE id = ?', id)!.lease_id, null, 'lease released')
  })

  test('a duplicate delivery while another worker holds the step lease is a no-op', async () => {
    const user = insertUser(t)
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    const id = await createScan(user, repo, 'security', 'manual')
    t.queue.length = 0
    t.db.write('UPDATE scans SET lease_id = ?, lease_until = ? WHERE id = ?', 'other-worker', Date.now() + 60_000, id)
    await runStep(id) // no GitHub stub: any work would hit an unexpected fetch
    const row = scanRow(t, id)
    assert.deepEqual([row.status, row.phase, row.attempts], ['queued', 'queued', 0])
    assert.deepEqual(t.queue, [])
    assertNoUnexpectedFetch(f)
  })

  test('an AI scan whose ChatGPT session disappears continues with heuristics', async () => {
    const user = insertUser(t) // no ChatGPT session linked
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    serveRepo(f, { fullName: 'acme/shop', files: SHOP_FILES })
    const id = await createScan(user, repo, 'security', 'manual')
    t.db.write(`UPDATE scans SET engine = 'ai', model = 'gpt-5.5' WHERE id = ?`, id)
    t.queue.shift()
    await runStep(id)
    const row = scanRow(t, id)
    assert.equal(row.engine, 'heuristic')
    assert.ok(events(t, id).some((e) => e.level === 'warn' && /continuing with heuristics/.test(e.message)))
  })

  test('without a queue binding the scan runs inline', async () => {
    const user = insertUser(t)
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    serveRepo(f, { fullName: 'acme/shop', files: SHOP_FILES })
    serveOsv(f)
    const { env } = await import('cloudflare:workers')
    delete (env as unknown as Record<string, unknown>).JOBS
    const id = await createScan(user, repo, 'security', 'manual')
    assert.equal(scanRow(t, id).status, 'completed')
  })
})

describe('scheduledTick', () => {
  const DAY = 86_400_000

  function pastProductScan(product: string, user: string, ageMs: number, trigger = 'manual') {
    t.db.write(
      `INSERT INTO product_scans (id, product_id, user_id, kind, trigger, created_at) VALUES (?, ?, ?, 'security', ?, ?)`,
      `old-${product}-${trigger}`,
      product,
      user,
      trigger,
      Date.now() - ageMs,
    )
  }
  /** Scheduled repository scans as "user:product name:repo". */
  const scheduled = () =>
    t.db
      .rows<{ user_id: string; name: string; repo_id: number }>(
        `SELECT s.user_id, p.name, s.repo_id FROM scans s JOIN product_scans ps ON ps.id = s.product_scan_id JOIN products p ON p.id = ps.product_id
         WHERE s.trigger = 'schedule' AND ps.trigger = 'schedule' AND s.kind = 'security'`,
      )
      .map((r) => `${r.user_id}:${r.name}:${r.repo_id}`)
      .sort()

  test('starts a scheduled product scan when the last non-push one is older than the frequency', async () => {
    const daily = insertUser(t)
    const weekly = insertUser(t)
    const monthly = insertUser(t)
    const manual = insertUser(t)
    const onPush = insertUser(t)
    const notOnboarded = insertUser(t, { onboarded: false })
    const defaults = insertUser(t) // preferences row "{}" → weekly by default
    setPreferences(t, daily, { frequency: 'daily' })
    setPreferences(t, weekly, { frequency: 'weekly' })
    setPreferences(t, monthly, { frequency: 'monthly' })
    setPreferences(t, manual, { frequency: 'manual' })
    setPreferences(t, onPush, { frequency: 'on_push' })
    setPreferences(t, notOnboarded, { frequency: 'daily' })
    setPreferences(t, defaults, {})
    const users = [daily, weekly, monthly, manual, onPush, notOnboarded, defaults]
    const all = users.map((id) => ({ id }))
    insertRepo(t, { id: 1, fullName: 'acme/api', users: all })
    insertRepo(t, { id: 2, fullName: 'acme/web', users: all.map((u) => ({ ...u, selected: false })) }) // "selected" does not matter here
    insertRepo(t, { id: 3, fullName: 'acme/fresh', users: all })
    insertRepo(t, { id: 4, fullName: 'acme/never', users: all })
    insertRepo(t, { id: 5, fullName: 'acme/gone', installationId: 50, users: all })
    t.db.write('UPDATE repositories SET removed_at = ? WHERE id = 5', Date.now()) // left the GitHub App
    const age = { due: { [daily]: 2 * DAY, [monthly]: 31 * DAY }, fresh: { [daily]: DAY / 2, [monthly]: 20 * DAY } }
    for (const u of users) {
      const due = await saveProduct(u, { name: 'due', repoIds: [1, 2, 5] })
      const fresh = await saveProduct(u, { name: 'fresh', repoIds: [3] })
      await saveProduct(u, { name: 'never', repoIds: [4] })
      await saveProduct(u, { name: 'empty', repoIds: [] })
      pastProductScan(due, u, age.due[u] ?? 8 * DAY)
      pastProductScan(due, u, 60_000, 'push') // push reviews do not count as the recurring report
      pastProductScan(fresh, u, age.fresh[u] ?? 3 * DAY)
    }

    await scheduledTick()
    const expected = [daily, weekly, monthly, defaults].flatMap((u) => [`${u}:due:1`, `${u}:due:2`, `${u}:never:4`]).sort()
    assert.deepEqual(scheduled(), expected)
    assert.equal(t.queue.length, expected.length)
    assert.equal(t.db.row<{ n: number }>(`SELECT COUNT(*) AS n FROM product_scans WHERE trigger = 'schedule'`)!.n, 8, 'one product scan per due product; none for an empty product')

    // The next tick finds fresh product scans.
    await scheduledTick()
    assert.deepEqual(scheduled(), expected)
  })

  test('unparseable preferences mean no schedule', async () => {
    const user = insertUser(t)
    setPreferences(t, user, { frequency: 'hourly' })
    insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    await saveProduct(user, { name: 'shop', repoIds: [1] })
    await scheduledTick()
    assert.deepEqual(scheduled(), [])
  })

  test('re-enqueues stalled scans (no progress for 10 minutes)', async () => {
    const user = insertUser(t, { onboarded: false })
    const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
    const stalled = await createScan(user, repo, 'security', 'manual')
    const fresh = await createScan(user, repo, 'understand', 'manual')
    t.queue.length = 0
    t.db.write('UPDATE scans SET updated_at = ? WHERE id = ?', Date.now() - 11 * 60_000, stalled)
    await scheduledTick()
    assert.deepEqual(t.queue, [{ scanId: stalled }])
    assert.equal(scanRow(t, fresh).status, 'queued')
  })
})
