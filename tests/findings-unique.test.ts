/**
 * One row per finding per scan (migration 0012): the unique index on findings(scan_id, fingerprint)
 * keeps two overlapping runs of the same step from storing a finding twice.
 */
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createScan, runStep } from '#/lib/scanner/engine'
import { assertNoUnexpectedFetch, drain, events, insertRepo, insertUser, resetEnv, scanRow, serveOsv, serveRepo, stubFetch, type FetchStub, type TestEnv } from './helpers/harness.ts'
import { LODASH_VULN, SHOP_FILES } from './helpers/fixtures.ts'

let t: TestEnv
let f: FetchStub
beforeEach(() => {
  t = resetEnv()
  f = stubFetch()
})
afterEach(() => f.restore())

const findings = (scanId: string) => t.db.rows<{ fingerprint: string }>('SELECT fingerprint FROM findings WHERE scan_id = ?', scanId)

test('a worker that outlives its lease and the worker that took over store each finding once', async () => {
  const user = insertUser(t)
  const repo = insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
  serveRepo(f, { fullName: 'acme/shop', files: SHOP_FILES })
  serveOsv(f, LODASH_VULN)
  const id = await createScan(user, repo, 'security', 'manual')
  while (scanRow(t, id).phase !== 'review') {
    t.queue.shift()
    await runStep(id)
  }
  t.queue.length = 0

  // Worker A takes the lease synchronously when runStep is called; expire it so worker B takes
  // the same review step over while A is still running (as if A had stalled past LEASE_MS).
  const a = runStep(id)
  t.db.write('UPDATE scans SET lease_until = 0 WHERE id = ?', id)
  const b = runStep(id)
  await Promise.all([a, b])
  assert.ok(events(t, id).some((e) => /outlived its lease/.test(e.message)), 'one worker lost the lease')

  const rows = findings(id)
  assert.ok(rows.length > 0)
  assert.equal(new Set(rows.map((r) => r.fingerprint)).size, rows.length, 'no fingerprint is stored twice')

  t.queue.length = 0
  t.queue.push({ scanId: id })
  await drain(t, runStep)
  assert.equal(scanRow(t, id).status, 'completed')
  const done = findings(id)
  assert.equal(new Set(done.map((r) => r.fingerprint)).size, done.length)
  assertNoUnexpectedFetch(f)
})

test('the same fingerprint is a separate finding in another scan', () => {
  const user = insertUser(t)
  insertRepo(t, { id: 1, fullName: 'acme/shop', users: [{ id: user }] })
  for (const [sid, status] of [['s1', 'completed'], ['s2', 'running']])
    t.db.write(`INSERT INTO scans (id, user_id, repo_id, kind, trigger, status, phase, created_at, updated_at) VALUES (?, ?, 1, 'security', 'manual', ?, 'review', 1, 1)`, sid, user, status)
  const ins = (fid: string, sid: string) =>
    t.db.write(`INSERT INTO findings (id, scan_id, repo_id, user_id, severity, category, title, description, fingerprint, created_at) VALUES (?, ?, 1, ?, 'high', 'code', 't', 'd', 'fp', 1)`, fid, sid, user)
  ins('f1', 's1')
  ins('f2', 's2')
  assert.throws(() => ins('f3', 's2'), /UNIQUE constraint failed/)
})

test('migration 0012 removes duplicates stored before it, keeping the oldest row', () => {
  const dir = new URL('../migrations/', import.meta.url)
  const files = readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()
  const db = new DatabaseSync(':memory:')
  for (const n of files.filter((n) => n < '0012')) db.exec(readFileSync(new URL(n, dir), 'utf8'))
  db.exec(`INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES ('u', 1, 'u', 1, 1)`)
  db.exec(`INSERT INTO repositories (id, full_name, created_at, updated_at) VALUES (1, 'acme/shop', 1, 1)`)
  db.exec(`INSERT INTO scans (id, user_id, repo_id, kind, trigger, status, phase, created_at, updated_at) VALUES ('s', 'u', 1, 'security', 'manual', 'completed', 'done', 1, 1)`)
  const ins = db.prepare(`INSERT INTO findings (id, scan_id, repo_id, user_id, severity, category, title, description, fingerprint, created_at) VALUES (?, 's', 1, 'u', 'high', 'code', 't', 'd', ?, 1)`)
  ins.run('f1', 'fp1')
  ins.run('f2', 'fp1')
  ins.run('f3', 'fp2')
  db.exec(readFileSync(new URL('0012_findings_unique_fingerprint.sql', dir), 'utf8'))
  assert.deepEqual(db.prepare('SELECT id FROM findings ORDER BY id').all().map((r) => r.id), ['f1', 'f3'])
})
