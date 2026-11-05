/** Scan lifecycle: one active scan per repo (database-enforced), cancel, and the progress cursor. */
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cancelScan, createScanOnce, runStep } from '#/lib/scanner/engine'
import { scanProgress } from '#/lib/queries'
import { TestD1 } from './helpers/d1.ts'
import { insertRepo, insertUser, resetEnv, scanRow, type TestEnv } from './helpers/harness.ts'

let t: TestEnv
let alice: string
let bob: string
const REPO = -7
beforeEach(() => {
  t = resetEnv()
  alice = insertUser(t, { login: 'alice' })
  bob = insertUser(t, { login: 'bob' })
  insertRepo(t, { id: REPO, fullName: 'acme/api', users: [{ id: alice, selected: true }, { id: bob, selected: true }] })
})
const count = () => t.db.row<{ n: number }>('SELECT COUNT(*) AS n FROM scans')!.n

test('two concurrent starts queue exactly one scan (database-enforced)', async () => {
  const [a, b] = await Promise.all([createScanOnce(alice, REPO, 'security', 'manual'), createScanOnce(alice, REPO, 'security', 'manual')])
  assert.equal(a.id, b.id)
  assert.deepEqual([a.existing, b.existing].sort(), [false, true])
  assert.equal(count(), 1)
  assert.equal(t.queue.length, 1, 'only the winner is enqueued')
})

test('a new scan can start once the previous one finished, and per kind and per user', async () => {
  const first = await createScanOnce(alice, REPO, 'security', 'manual')
  t.db.write(`UPDATE scans SET status = 'completed' WHERE id = ?`, first.id)
  const second = await createScanOnce(alice, REPO, 'security', 'manual')
  assert.equal(second.existing, false)
  assert.notEqual(second.id, first.id)
  assert.equal((await createScanOnce(alice, REPO, 'understand', 'manual')).existing, false)
  assert.equal((await createScanOnce(bob, REPO, 'security', 'manual')).existing, false)
})

test('the index rejects a second active row even if app code skipped the check', () => {
  const ins = (id: string, status: string) =>
    t.db.write(`INSERT INTO scans (id, user_id, repo_id, kind, trigger, status, phase, created_at, updated_at) VALUES (?, ?, ?, 'security', 'manual', ?, 'queued', 1, 1)`, id, alice, REPO, status)
  ins('x1', 'queued')
  assert.throws(() => ins('x2', 'running'), /UNIQUE constraint failed/)
  ins('x3', 'failed') // finished rows are unconstrained
})

test('cancel: only active scans, only the owner, and a cancelled scan never moves again', async () => {
  const { id } = await createScanOnce(alice, REPO, 'security', 'manual')
  assert.deepEqual(await cancelScan(bob, id), { ok: false, reason: 'not_found' })
  assert.deepEqual(await cancelScan(alice, id), { ok: true })
  assert.equal(scanRow(t, id).status, 'cancelled')
  assert.deepEqual(await cancelScan(alice, id), { ok: false, reason: 'not_active', status: 'cancelled' })

  await runStep(id) // a step already sitting in the queue
  assert.equal(scanRow(t, id).status, 'cancelled')
  assert.equal(scanRow(t, id).lease_id, null, 'the step lease is never taken for a cancelled scan')
  assert.equal(t.queue.length, 1, 'no further steps were enqueued')

  // Cancelled scans don't hold the active slot.
  assert.equal((await createScanOnce(alice, REPO, 'security', 'manual')).existing, false)
})

test('progress: returns only events after the cursor, and only to the owner', async () => {
  const { id } = await createScanOnce(alice, REPO, 'security', 'manual')
  await cancelScan(alice, id)
  const all = await scanProgress(alice, id)
  assert.ok(all)
  assert.equal(all.status, 'cancelled')
  assert.equal(all.live, false)
  assert.deepEqual(all.events.map((e) => e.message), ['Queued security scan (manual)', 'Cancelled by the user'])
  const rest = await scanProgress(alice, id, all.events[0].id)
  assert.deepEqual(rest?.events.map((e) => e.message), ['Cancelled by the user'])
  assert.equal(rest?.cursor, all.cursor)
  const none = await scanProgress(alice, id, all.cursor)
  assert.equal(none?.events.length, 0)
  assert.equal(none?.cursor, all.cursor, 'cursor is stable when nothing is new')
  assert.equal(await scanProgress(bob, id), null)
})

test('migration 0011 closes pre-existing duplicate active scans, keeping the newest', () => {
  const db = new TestD1().sqlite
  db.exec('DROP INDEX scans_one_active')
  db.exec(`INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES ('u1', 1, 'a', 1, 1)`)
  db.exec(`INSERT INTO repositories (id, full_name, private, created_at, updated_at) VALUES (1, 'a/b', 0, 1, 1)`)
  const ins = db.prepare(`INSERT INTO scans (id, user_id, repo_id, kind, trigger, status, created_at, updated_at) VALUES (?, 'u1', 1, 'security', 'manual', ?, ?, ?)`)
  ins.run('old', 'running', 1, 1)
  ins.run('new', 'queued', 2, 2)
  ins.run('done', 'completed', 0, 0)
  db.exec(readFileSync(new URL('../migrations/0011_scan_lifecycle.sql', import.meta.url), 'utf8'))
  const rows = Object.fromEntries((db.prepare('SELECT id, status FROM scans').all() as Array<{ id: string; status: string }>).map((r) => [r.id, r.status]))
  assert.deepEqual(rows, { old: 'failed', new: 'queued', done: 'completed' })
})
