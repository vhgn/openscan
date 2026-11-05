/** GitHub App webhook (src/routes/api/github/webhook.ts): signature check and event effects. */
import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { env } from 'cloudflare:workers'
import { Route } from '#/routes/api/github/webhook'
import { createScan } from '#/lib/scanner/engine'
import { saveProduct } from '#/lib/products'
import { APP_URL, githubSignature, insertRepo, insertUser, resetEnv, setPreferences, stubFetch, type FetchStub, type TestEnv } from './helpers/harness.ts'

type Handler = (ctx: { request: Request }) => Promise<Response>
const handle = (Route.options as unknown as { server: { handlers: { POST: Handler } } }).server.handlers.POST

let t: TestEnv
let f: FetchStub
beforeEach(() => {
  t = resetEnv()
  f = stubFetch() // the webhook itself never calls out
})
afterEach(() => {
  f.restore()
  assert.deepEqual(f.unexpected, [])
})

function deliver(event: string, payload: unknown, signature?: string | null) {
  const body = JSON.stringify(payload)
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-github-event': event }
  const sig = signature === undefined ? githubSignature(body) : signature
  if (sig !== null) headers['x-hub-signature-256'] = sig
  return handle({ request: new Request(`${APP_URL}/api/github/webhook`, { method: 'POST', headers, body }) })
}

const installation = (id: number, login = 'octo') => ({ id, account: { login, type: 'User' }, repository_selection: 'selected', suspended_at: null })
const count = (sql: string, ...p: Array<string | number>) => t.db.row<{ n: number }>(sql, ...p)!.n

describe('signature', () => {
  const payload = { action: 'created', installation: installation(10), repositories: [{ id: 1, full_name: 'octo/a', private: true }] }

  test('a valid HMAC-SHA256 signature is accepted', async () => {
    const res = await deliver('installation', payload)
    assert.equal(res.status, 200)
    assert.equal(await res.text(), 'ok')
    assert.equal(count('SELECT COUNT(*) AS n FROM installations'), 1)
  })

  test('missing, wrong-secret, tampered and malformed signatures are rejected without side effects', async () => {
    const body = JSON.stringify(payload)
    const cases: Array<[string, string | null, string?]> = [
      ['missing', null],
      ['empty', ''],
      ['wrong secret', githubSignature(body, 'not-the-secret')],
      ['signature of another body', githubSignature(JSON.stringify({ ...payload, action: 'deleted' }))],
      ['bare hex without the sha256= prefix', githubSignature(body).slice('sha256='.length)],
      ['sha1 header format', `sha1=${githubSignature(body).slice(7, 47)}`],
      ['uppercase hex', githubSignature(body).toUpperCase().replace('SHA256=', 'sha256=')],
    ]
    for (const [name, sig] of cases) {
      const res = await deliver('installation', payload, sig)
      assert.equal(res.status, 401, name)
      assert.equal(await res.text(), 'bad signature')
    }
    // Tampered body: signed once, body changed in transit.
    const tampered = await handle({
      request: new Request(`${APP_URL}/api/github/webhook`, {
        method: 'POST',
        headers: { 'x-github-event': 'installation', 'x-hub-signature-256': githubSignature(body) },
        body: body.replace('octo/a', 'evil/a'),
      }),
    })
    assert.equal(tampered.status, 401)
    assert.equal(count('SELECT COUNT(*) AS n FROM installations'), 0)
    assert.equal(count('SELECT COUNT(*) AS n FROM repositories'), 0)
  })

  test('without a configured secret every delivery is rejected', async () => {
    delete (env as unknown as Record<string, unknown>).GITHUB_WEBHOOK_SECRET
    assert.equal((await deliver('installation', payload, githubSignature(JSON.stringify(payload), ''))).status, 401)
    assert.equal((await deliver('installation', payload)).status, 401)
  })
})

describe('installation events', () => {
  test('created: mirrors the installation and its repositories', async () => {
    await deliver('installation', { action: 'created', installation: installation(10), repositories: [{ id: 1, full_name: 'octo/a', private: true }, { id: 2, full_name: 'octo/b', private: false }] })
    assert.deepEqual(t.db.rows('SELECT id, account_login, account_type, repository_selection FROM installations'), [{ id: 10, account_login: 'octo', account_type: 'User', repository_selection: 'selected' }])
    assert.deepEqual(t.db.rows('SELECT id, installation_id, full_name, private, html_url, removed_at FROM repositories ORDER BY id'), [
      { id: 1, installation_id: 10, full_name: 'octo/a', private: 1, html_url: 'https://github.com/octo/a', removed_at: null },
      { id: 2, installation_id: 10, full_name: 'octo/b', private: 0, html_url: 'https://github.com/octo/b', removed_at: null },
    ])
  })

  test('deleted: unlinks users and marks repositories removed, keeping scan history', async () => {
    const user = insertUser(t)
    insertRepo(t, { id: 1, fullName: 'octo/a', installationId: 10, users: [{ id: user }] })
    insertRepo(t, { id: 3, fullName: 'other/c', installationId: 30, users: [{ id: user }] })
    const scan = await createScan(user, 1, 'security', 'manual')
    const res = await deliver('installation', { action: 'deleted', installation: installation(10) })
    assert.equal(res.status, 200)
    assert.equal(count('SELECT COUNT(*) AS n FROM installations WHERE id = 10'), 0)
    assert.equal(count('SELECT COUNT(*) AS n FROM user_installations WHERE installation_id = 10'), 0)
    assert.deepEqual(t.db.rows('SELECT repo_id FROM user_repositories'), [{ repo_id: 3 }], "other installations' repos stay linked")
    assert.ok(t.db.row<{ removed_at: number | null }>('SELECT removed_at FROM repositories WHERE id = 1')!.removed_at)
    assert.equal(t.db.row<{ removed_at: number | null }>('SELECT removed_at FROM repositories WHERE id = 3')!.removed_at, null)
    assert.equal(count('SELECT COUNT(*) AS n FROM scans WHERE id = ?', scan), 1, 'scan history survives')
  })
})

describe('installation_repositories', () => {
  test('added: upserts repos and links them (unselected) to every user of the installation', async () => {
    const a = insertUser(t)
    const b = insertUser(t)
    const stranger = insertUser(t)
    insertRepo(t, { id: 1, fullName: 'octo/a', installationId: 10, users: [{ id: a }, { id: b }] })
    insertRepo(t, { id: 9, fullName: 'else/z', installationId: 90, users: [{ id: stranger }] })
    await deliver('installation_repositories', { action: 'added', installation: installation(10), repositories_added: [{ id: 2, full_name: 'octo/b', private: true }], repositories_removed: [] })
    assert.deepEqual(t.db.rows('SELECT user_id, selected FROM user_repositories WHERE repo_id = 2 ORDER BY user_id'), [
      { user_id: a, selected: 0 },
      { user_id: b, selected: 0 },
    ])
    assert.equal(t.db.row<{ installation_id: number }>('SELECT installation_id FROM repositories WHERE id = 2')!.installation_id, 10)
  })

  test('removed: detaches the repo (history kept); re-adding it clears the mark', async () => {
    const user = insertUser(t)
    insertRepo(t, { id: 1, fullName: 'octo/a', installationId: 10, users: [{ id: user }] })
    insertRepo(t, { id: 2, fullName: 'octo/b', installationId: 10, users: [{ id: user }] })
    const scan = await createScan(user, 2, 'security', 'manual')
    await deliver('installation_repositories', { action: 'removed', installation: installation(10), repositories_added: [], repositories_removed: [{ id: 2 }] })
    assert.deepEqual(t.db.rows('SELECT repo_id FROM user_repositories'), [{ repo_id: 1 }])
    assert.ok(t.db.row<{ removed_at: number | null }>('SELECT removed_at FROM repositories WHERE id = 2')!.removed_at)
    assert.equal(count('SELECT COUNT(*) AS n FROM scans WHERE id = ?', scan), 1)

    await deliver('installation_repositories', { action: 'added', installation: installation(10), repositories_added: [{ id: 2, full_name: 'octo/b', private: true }], repositories_removed: [] })
    assert.equal(t.db.row<{ removed_at: number | null }>('SELECT removed_at FROM repositories WHERE id = 2')!.removed_at, null)
    assert.deepEqual(t.db.rows('SELECT repo_id, selected FROM user_repositories ORDER BY repo_id'), [
      { repo_id: 1, selected: 1 },
      { repo_id: 2, selected: 0 },
    ])
  })
})

describe('push', () => {
  const push = (ref: string, repoId = 1) => ({
    ref,
    before: 'b'.repeat(40),
    after: 'a'.repeat(40),
    repository: { id: repoId, full_name: 'octo/a', default_branch: 'main' },
  })

  /** Users whose products include repo 1 (and its sibling repo 2) in different configurations. */
  async function watchers() {
    const optedIn = insertUser(t) // product opted repo 1 into push scans, repo selected
    const onPushPref = insertUser(t) // "on every push" preference: new members opt in by default
    const notOptedIn = insertUser(t)
    const unselected = insertUser(t)
    const noProduct = insertUser(t)
    setPreferences(t, onPushPref, { frequency: 'on_push' })
    insertRepo(t, {
      id: 1,
      fullName: 'octo/a',
      installationId: 10,
      users: [{ id: optedIn }, { id: onPushPref }, { id: notOptedIn }, { id: unselected, selected: false }, { id: noProduct }],
    })
    insertRepo(t, { id: 2, fullName: 'octo/b', installationId: 10, users: [{ id: optedIn }, { id: onPushPref }] })
    const products = {
      optedIn: await saveProduct(optedIn, { name: 'A', repoIds: [1, 2], pushRepoIds: [1, 2] }),
      onPushPref: await saveProduct(onPushPref, { name: 'B', repoIds: [1, 2] }),
      notOptedIn: await saveProduct(notOptedIn, { name: 'C', repoIds: [1], pushRepoIds: [] }),
      unselected: await saveProduct(unselected, { name: 'D', repoIds: [1], pushRepoIds: [1] }),
    }
    return { optedIn, onPushPref, products }
  }

  test('to the default branch: a differential scan of the pushed repo for each product that opted it in', async () => {
    const { optedIn, onPushPref, products } = await watchers()
    assert.equal((await deliver('push', push('refs/heads/main'))).status, 200)
    const scans = t.db.rows<{ id: string; user_id: string; repo_id: number; kind: string; trigger: string; state_json: string; product_scan_id: string }>(
      'SELECT * FROM scans ORDER BY user_id',
    )
    assert.deepEqual(
      scans.map((s) => [s.user_id, s.repo_id, s.kind, s.trigger]),
      [
        [optedIn, 1, 'security', 'push'],
        [onPushPref, 1, 'security', 'push'],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      'only the pushed repo, not its sibling; only selected + opted-in repos',
    )
    for (const s of scans) assert.deepEqual(JSON.parse(s.state_json), { diff: { base: 'b'.repeat(40), head: 'a'.repeat(40) } })
    assert.deepEqual(
      t.db.rows('SELECT product_id, trigger, push_repo_id, commit_sha FROM product_scans ORDER BY product_id'),
      [products.optedIn, products.onPushPref].sort().map((product_id) => ({ product_id, trigger: 'push', push_repo_id: 1, commit_sha: 'a'.repeat(40) })),
    )
    assert.equal(t.queue.length, 2)
  })

  test('to another branch or a tag: nothing', async () => {
    await watchers()
    await deliver('push', push('refs/heads/feature'))
    await deliver('push', push('refs/tags/main'))
    assert.equal(count('SELECT COUNT(*) AS n FROM scans'), 0)
    assert.equal(t.queue.length, 0)
  })

  test('other events are acknowledged and ignored', async () => {
    await watchers()
    const res = await deliver('ping', { zen: 'Keep it logically awesome.' })
    assert.equal(res.status, 200)
    assert.equal(count('SELECT COUNT(*) AS n FROM scans'), 0)
  })
})
