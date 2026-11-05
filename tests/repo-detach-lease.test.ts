import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { detachInstallationOps, detachReposOps } from '../src/lib/github/detach.ts'
import { acquireLease, LEASE_MS, releaseLease, STALL_MS, STALLED_SCANS_SQL, type Exec } from '../src/lib/scanner/lease.ts'

/** A fresh database with every migration applied and foreign keys enforced (as on D1). */
function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const dir = new URL('../migrations/', import.meta.url)
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'))
  const exec: Exec = async (sql, ...params) => Number(db.prepare(sql).run(...params).changes)
  const runOps = (ops: Array<[string, Array<string | number | null>]>) => {
    db.exec('BEGIN')
    for (const [sql, params] of ops) db.prepare(sql).run(...params)
    db.exec('COMMIT')
  }
  const count = (sql: string, ...params: Array<string | number>) => (db.prepare(sql).get(...params) as { n: number }).n
  return { db, exec, runOps, count }
}

/** A user who scanned repo 1 (installation 10) and repo 2 (installation 10), with findings and questions. */
function seed(db: DatabaseSync) {
  db.exec(`
    INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES ('u1', 1, 'octo', 0, 0);
    INSERT INTO installations (id, account_login, account_type, created_at, updated_at) VALUES (10, 'octo', 'User', 0, 0);
    INSERT INTO user_installations (user_id, installation_id) VALUES ('u1', 10);
    INSERT INTO repositories (id, installation_id, full_name, created_at, updated_at) VALUES (1, 10, 'octo/a', 0, 0), (2, 10, 'octo/b', 0, 0);
    INSERT INTO user_repositories (user_id, repo_id, selected, created_at) VALUES ('u1', 1, 1, 0), ('u1', 2, 1, 0);
    INSERT INTO scans (id, user_id, repo_id, kind, trigger, status, created_at, updated_at) VALUES
      ('s1', 'u1', 1, 'security', 'manual', 'completed', 0, 0),
      ('s2', 'u1', 2, 'security', 'manual', 'completed', 0, 0);
    INSERT INTO findings (id, scan_id, repo_id, user_id, severity, category, title, description, fingerprint, created_at) VALUES
      ('f1', 's1', 1, 'u1', 'high', 'code', 'x', 'x', 'fp1', 0),
      ('f2', 's2', 2, 'u1', 'high', 'code', 'y', 'y', 'fp2', 0);
    INSERT INTO questions (id, user_id, repo_id, scan_id, question, created_at) VALUES ('q1', 'u1', 1, 's1', 'Is it public?', 0);
  `)
}

test('removing a repo from the app keeps its scans, findings and questions', () => {
  const { db, runOps, count } = freshDb()
  seed(db)
  runOps(detachReposOps([1], 123))
  assert.equal(count('SELECT COUNT(*) AS n FROM scans WHERE repo_id = 1'), 1)
  assert.equal(count('SELECT COUNT(*) AS n FROM findings WHERE repo_id = 1'), 1)
  assert.equal(count('SELECT COUNT(*) AS n FROM questions WHERE repo_id = 1'), 1)
  assert.equal(count('SELECT COUNT(*) AS n FROM repositories WHERE id = 1 AND removed_at = 123'), 1)
  // Unlinked: gone from the picker, scheduled reports and push triggers.
  assert.equal(count('SELECT COUNT(*) AS n FROM user_repositories WHERE repo_id = 1'), 0)
  // The other repo is untouched.
  assert.equal(count('SELECT COUNT(*) AS n FROM user_repositories WHERE repo_id = 2'), 1)
  assert.equal(count('SELECT COUNT(*) AS n FROM repositories WHERE id = 2 AND removed_at IS NULL'), 1)
})

test('uninstalling the app keeps scan history for every repo of the installation', () => {
  const { db, runOps, count } = freshDb()
  seed(db)
  runOps(detachInstallationOps(10, 123))
  assert.equal(count('SELECT COUNT(*) AS n FROM installations'), 0)
  assert.equal(count('SELECT COUNT(*) AS n FROM user_installations'), 0)
  assert.equal(count('SELECT COUNT(*) AS n FROM user_repositories'), 0)
  assert.equal(count('SELECT COUNT(*) AS n FROM repositories WHERE removed_at = 123'), 2)
  assert.equal(count('SELECT COUNT(*) AS n FROM scans'), 2)
  assert.equal(count('SELECT COUNT(*) AS n FROM findings'), 2)
})

test('a repository with scan history cannot be deleted (no silent cascade)', () => {
  const { db, count } = freshDb()
  seed(db)
  assert.throws(() => db.exec('DELETE FROM repositories WHERE id = 1'), /scan history/)
  assert.equal(count('SELECT COUNT(*) AS n FROM findings WHERE repo_id = 1'), 1)
  // A repo nobody scanned can still be deleted.
  db.exec("INSERT INTO repositories (id, installation_id, full_name, created_at, updated_at) VALUES (3, 10, 'octo/c', 0, 0)")
  db.exec('DELETE FROM repositories WHERE id = 3')
  assert.equal(count('SELECT COUNT(*) AS n FROM repositories WHERE id = 3'), 0)
})

test('re-granting a removed repo clears removed_at', () => {
  const { db, runOps, count } = freshDb()
  seed(db)
  runOps(detachReposOps([1], 123))
  // Same statement shape as repoUpsert's ON CONFLICT clause.
  db.exec(`INSERT INTO repositories (id, installation_id, full_name, created_at, updated_at) VALUES (1, 10, 'octo/a', 0, 0)
           ON CONFLICT(id) DO UPDATE SET installation_id = excluded.installation_id, removed_at = NULL, updated_at = excluded.updated_at`)
  assert.equal(count('SELECT COUNT(*) AS n FROM repositories WHERE id = 1 AND removed_at IS NULL'), 1)
})

function seedRunningScan(db: DatabaseSync) {
  seed(db)
  db.exec(`INSERT INTO scans (id, user_id, repo_id, kind, trigger, status, created_at, updated_at) VALUES ('run', 'u1', 1, 'security', 'manual', 'running', 0, 0)`)
}

test('only one worker holds a scan step lease at a time', async () => {
  const { db, exec } = freshDb()
  seedRunningScan(db)
  const t = 1_000_000
  assert.equal(await acquireLease(exec, 'run', 'a', t), true)
  assert.equal(await acquireLease(exec, 'run', 'b', t + 1000), false, 'duplicate delivery while the step runs')
  await releaseLease(exec, 'run', 'a')
  assert.equal(await acquireLease(exec, 'run', 'b', t + 2000), true, 'next step takes the lease after release')
})

test('an expired lease (crashed worker) is taken over, and the old holder cannot release or write', async () => {
  const { db, exec, count } = freshDb()
  seedRunningScan(db)
  const t = 1_000_000
  assert.equal(await acquireLease(exec, 'run', 'a', t), true)
  assert.equal(await acquireLease(exec, 'run', 'b', t + LEASE_MS + 1), true)
  await releaseLease(exec, 'run', 'a') // stale holder finishing late
  assert.equal(count("SELECT COUNT(*) AS n FROM scans WHERE id = 'run' AND lease_id = 'b'"), 1)
  // Fenced write from the stale holder changes nothing.
  assert.equal(await exec("UPDATE scans SET phase = 'stale' WHERE id = ? AND lease_id = ?", 'run', 'a'), 0)
})

test('finished scans cannot be leased', async () => {
  const { db, exec } = freshDb()
  seed(db)
  assert.equal(await acquireLease(exec, 's1', 'a', 1), false)
})

test('the cron does not revive a scan whose step still holds a live lease', async () => {
  const { db, exec } = freshDb()
  seedRunningScan(db)
  const t = 100 * 60_000
  const stalled = () => (db.prepare(STALLED_SCANS_SQL).all(t - STALL_MS, t) as Array<{ id: string }>).map((r) => r.id)
  assert.deepEqual(stalled(), ['run'], 'no update for 10 min and no lease → revived')
  await acquireLease(exec, 'run', 'a', t - STALL_MS - 1)
  assert.deepEqual(stalled(), [], 'long step still running → left alone')
  db.prepare("UPDATE scans SET lease_until = ? WHERE id = 'run'").run(t - 1) // lease expired: worker died
  assert.deepEqual(stalled(), ['run'])
})
