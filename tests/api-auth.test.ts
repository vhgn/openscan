/**
 * Authorization: cookie sessions (src/lib/session.ts), the REST routes under
 * src/routes/api/scans, and the user-scoped write actions (src/lib/actions.ts).
 * Route handlers are called the way TanStack Start calls them: handlers.METHOD({ request, params }).
 */
import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { clearSessionCookieHeader, createSession, sessionCookieHeader, userFromRequest } from '#/lib/session'
import { answerQuestionFor, setFindingStatus, startScanFor } from '#/lib/actions'
import { createScan } from '#/lib/scanner/engine'
import { saveProduct } from '#/lib/products'
import { Route as ScansRoute } from '#/routes/api/scans/index'
import { Route as ScanRoute } from '#/routes/api/scans/$scanId'
import { APP_URL, insertRepo, insertUser, resetEnv, scanRow, serveRepo, stubFetch, type FetchStub, type TestEnv } from './helpers/harness.ts'

type Handler = (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>
function handler(route: { options: unknown }, method: 'GET' | 'POST'): Handler {
  return (route.options as { server: { handlers: Record<string, Handler> } }).server.handlers[method]
}
const listScans = handler(ScansRoute, 'GET')
const postScan = handler(ScansRoute, 'POST')
const getScan = handler(ScanRoute, 'GET')

let t: TestEnv
let f: FetchStub
beforeEach(() => {
  t = resetEnv()
  f = stubFetch() // nothing here may touch the network
})
afterEach(() => {
  f.restore()
  assert.deepEqual(f.unexpected, [])
})

const cookie = (token: string) => ({ cookie: `theme=dark; openscan_session=${token}; other=1` })

function req(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Request(`${APP_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...init.headers }, body: init.body })
}

/** Two users, each with a linked repo; returns their session tokens. */
async function twoUsers() {
  const alice = insertUser(t, { login: 'alice' })
  const bob = insertUser(t, { login: 'bob' })
  insertRepo(t, { id: 1, fullName: 'alice/app', installationId: 10, users: [{ id: alice }] })
  insertRepo(t, { id: 2, fullName: 'bob/app', installationId: 20, users: [{ id: bob }] })
  return { alice, bob, aliceToken: await createSession(alice), bobToken: await createSession(bob) }
}

describe('sessions', () => {
  test('the database stores only the sha256 of the cookie token', async () => {
    const user = insertUser(t)
    const token = await createSession(user)
    const rows = t.db.rows<{ id: string; user_id: string; expires_at: number }>('SELECT id, user_id, expires_at FROM sessions')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, createHash('sha256').update(token).digest('hex'))
    assert.notEqual(rows[0].id, token)
    assert.ok(Math.abs(rows[0].expires_at - (Date.now() + 30 * 86_400_000)) < 60_000, '30-day sessions')
  })

  test('userFromRequest resolves the session cookie, and nothing else', async () => {
    const user = insertUser(t, { login: 'octo' })
    const token = await createSession(user)
    assert.equal((await userFromRequest(req('/', { headers: cookie(token) })))?.login, 'octo')
    assert.equal(await userFromRequest(req('/')), null, 'no cookie')
    assert.equal(await userFromRequest(req('/', { headers: { cookie: 'openscan_session=forged' } })), null, 'unknown token')
    assert.equal(await userFromRequest(req('/', { headers: { cookie: `other_session=${token}` } })), null, 'token under another cookie name')
    const hash = createHash('sha256').update(token).digest('hex')
    assert.equal(await userFromRequest(req('/', { headers: { cookie: `openscan_session=${hash}` } })), null, 'the stored hash is not a credential')
    t.db.write('UPDATE sessions SET expires_at = ?', Date.now() - 1)
    assert.equal(await userFromRequest(req('/', { headers: cookie(token) })), null, 'expired session')
  })

  test(
    'a malformed session cookie is treated as signed out',
    { todo: 'BUG: readCookieFrom (src/lib/session.ts) calls decodeURIComponent unguarded, so a cookie like "openscan_session=%E0%A4%A" throws URIError and every API route answers 500 instead of 401' },
    async () => {
      assert.equal(await userFromRequest(req('/', { headers: { cookie: 'openscan_session=%E0%A4%A' } })), null)
    },
  )

  test('cookie headers: HttpOnly, SameSite=Lax, Secure only over https', () => {
    assert.equal(sessionCookieHeader('tok', 'https://openscan.test/x'), 'openscan_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure')
    assert.equal(sessionCookieHeader('tok', 'http://localhost:3000/'), 'openscan_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000')
    assert.equal(clearSessionCookieHeader(), 'openscan_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
  })
})

describe('GET /api/scans', () => {
  test('401 without a session', async () => {
    const res = await listScans({ request: req('/api/scans'), params: {} })
    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), { error: 'unauthenticated' })
  })

  test("lists only the caller's scans", async () => {
    const { alice, bob, aliceToken } = await twoUsers()
    const mine = await createScan(alice, 1, 'security', 'manual')
    await createScan(bob, 2, 'security', 'manual')
    const res = await listScans({ request: req('/api/scans', { headers: cookie(aliceToken) }), params: {} })
    assert.equal(res.status, 200)
    const { scans } = (await res.json()) as { scans: Array<{ id: string; repo: string; status: string }> }
    assert.deepEqual(scans.map((s) => [s.id, s.repo, s.status]), [[mine, 'alice/app', 'queued']])
  })
})

describe('POST /api/scans', () => {
  const post = (token: string | null, body: string) => postScan({ request: req('/api/scans', { method: 'POST', headers: token ? cookie(token) : {}, body }), params: {} })

  test('401 without a session (before the body is even looked at)', async () => {
    assert.equal((await post(null, JSON.stringify({ repoId: 1 }))).status, 401)
    assert.equal((await post('forged', 'not json')).status, 401)
    assert.equal(t.queue.length, 0)
  })

  test('400 on a malformed body', async () => {
    const { aliceToken } = await twoUsers()
    for (const body of ['not json', '{}', JSON.stringify({ repoId: '1' }), JSON.stringify({ repoId: 1.5 }), JSON.stringify({ repoId: 1, kind: 'deep' })]) {
      const res = await post(aliceToken, body)
      assert.equal(res.status, 400, body)
      assert.equal(((await res.json()) as { error: string }).error, 'invalid_body')
    }
    assert.equal(t.queue.length, 0)
  })

  test("404 for another user's repository or an unknown one", async () => {
    const { aliceToken } = await twoUsers()
    for (const repoId of [2, 999]) {
      const res = await post(aliceToken, JSON.stringify({ repoId }))
      assert.equal(res.status, 404)
      assert.equal(((await res.json()) as { error: string }).error, 'repo_not_found')
    }
    assert.equal(t.db.row<{ n: number }>('SELECT COUNT(*) AS n FROM scans')!.n, 0)
  })

  test('{repo: "owner/name"}: any public repository is linked on the way and scanned', async () => {
    const { alice, aliceToken, bobToken } = await twoUsers()
    serveRepo(f, { fullName: 'acme/public', id: 4242, files: {} })
    const res = await post(aliceToken, JSON.stringify({ repo: 'acme/public' }))
    assert.equal(res.status, 202)
    const body = (await res.json()) as { id: string; repo: string; url: string }
    assert.deepEqual([body.repo, body.url], ['acme/public', `/scans/${body.id}`])
    // Stored under a negative id with no installation, so it is always read anonymously.
    assert.deepEqual(t.db.row('SELECT id, installation_id, private FROM repositories WHERE full_name = ?', 'acme/public'), { id: -4242, installation_id: null, private: 0 })
    assert.deepEqual(t.db.row('SELECT user_id, selected FROM user_repositories WHERE repo_id = -4242'), { user_id: alice, selected: 0 })
    assert.deepEqual(t.db.row('SELECT user_id, repo_id, kind FROM scans WHERE id = ?', body.id), { user_id: alice, repo_id: -4242, kind: 'security' })
    assert.deepEqual(t.queue, [{ scanId: body.id }])

    // A pasted URL resolves to the same repo and the scan already running; no second GitHub lookup.
    const lookups = f.calls.length
    const again = (await (await post(aliceToken, JSON.stringify({ repo: 'https://github.com/acme/public/tree/main' }))).json()) as { id: string }
    assert.equal(again.id, body.id)
    // Another user reuses the stored row without asking GitHub again, and gets their own scan.
    const bobs = (await (await post(bobToken, JSON.stringify({ repo: 'ACME/Public' }))).json()) as { id: string; repo: string }
    assert.notEqual(bobs.id, body.id)
    assert.equal(bobs.repo, 'acme/public')
    assert.equal(f.calls.length, lookups)
  })

  test('{repo}: a linked repository by name needs no GitHub lookup', async () => {
    const { aliceToken } = await twoUsers()
    const res = await post(aliceToken, JSON.stringify({ repo: 'alice/app', kind: 'understand' }))
    assert.equal(res.status, 202)
    assert.equal(((await res.json()) as { repo: string }).repo, 'alice/app')
    assert.deepEqual(f.calls, [])
  })

  test("{repo}: another user's private repository by name is refused and not linked", async () => {
    const { alice, aliceToken } = await twoUsers()
    // bob/app is in the database (bob's installation), but alice only gets what anonymous GitHub shows her.
    f.on('GET', 'https://api.github.com/repos/bob/app', (r) => {
      assert.equal(r.headers.get('authorization'), null, 'looked up anonymously')
      return Response.json({ id: 2, full_name: 'bob/app', default_branch: 'main', private: true, html_url: '', description: null, language: null })
    })
    const res = await post(aliceToken, JSON.stringify({ repo: 'bob/app' }))
    assert.equal(res.status, 404)
    assert.equal(((await res.json()) as { error: string }).error, 'repo_private')
    assert.equal(t.db.row<{ n: number }>('SELECT COUNT(*) AS n FROM user_repositories WHERE user_id = ?', alice)!.n, 1)
    assert.equal(t.db.row<{ n: number }>('SELECT COUNT(*) AS n FROM scans')!.n, 0)
  })

  test('{repo}: invalid names, missing repositories and GitHub outages', async () => {
    const { aliceToken } = await twoUsers()
    f.on('GET', 'https://api.github.com/repos/acme/missing', () => new Response('Not Found', { status: 404 }))
    f.on('GET', 'https://api.github.com/repos/acme/down', () => new Response('rate limited', { status: 403 }))
    f.on('GET', /^https:\/\/data\.jsdelivr\.com\//, () => new Response('nope', { status: 404 }))
    const cases: Array<[unknown, number, string]> = [
      [{ repo: 'not a repo' }, 400, 'invalid_repo'],
      [{ repo: 'https://gitlab.com/a/b' }, 400, 'invalid_repo'],
      [{ repo: '' }, 400, 'invalid_body'],
      [{ repo: 'acme/missing' }, 404, 'repo_not_found'],
      [{ repo: 'acme/down' }, 503, 'github_unavailable'],
    ]
    for (const [body, status, error] of cases) {
      const res = await post(aliceToken, JSON.stringify(body))
      assert.equal(res.status, status, JSON.stringify(body))
      assert.equal(((await res.json()) as { error: string }).error, error)
    }
    assert.equal(t.db.row<{ n: number }>('SELECT COUNT(*) AS n FROM scans')!.n, 0)
    assert.equal(t.db.row<{ n: number }>('SELECT COUNT(*) AS n FROM repositories WHERE id < 0')!.n, 0)
  })

  test('202 queues a scan of a linked repository; a second request reuses it', async () => {
    const { aliceToken, alice } = await twoUsers()
    const res = await post(aliceToken, JSON.stringify({ repoId: 1 }))
    assert.equal(res.status, 202)
    const body = (await res.json()) as { id: string; url: string }
    assert.equal(body.url, `/scans/${body.id}`)
    const row = scanRow(t, body.id)
    assert.deepEqual([row.kind, row.trigger, row.status], ['security', 'manual', 'queued'])
    assert.equal(t.db.row<{ user_id: string }>('SELECT user_id FROM scans WHERE id = ?', body.id)!.user_id, alice)
    assert.deepEqual(t.queue, [{ scanId: body.id }])

    const again = (await (await post(aliceToken, JSON.stringify({ repoId: 1 }))).json()) as { id: string }
    assert.equal(again.id, body.id)
    const understand = (await (await post(aliceToken, JSON.stringify({ repoId: 1, kind: 'understand' }))).json()) as { id: string }
    assert.equal(scanRow(t, understand.id).kind, 'understand')
  })
})

describe('POST /api/scans {productId}', () => {
  const post = (token: string, body: unknown) => postScan({ request: req('/api/scans', { method: 'POST', headers: cookie(token), body: JSON.stringify(body) }), params: {} })

  test("404 for another user's or an unknown product, 409 for an empty one, 202 otherwise", async () => {
    const { alice, bob, aliceToken } = await twoUsers()
    const bobs = await saveProduct(bob, { name: 'Bob', repoIds: [2] })
    const empty = await saveProduct(alice, { name: 'Empty', repoIds: [] })
    const mine = await saveProduct(alice, { name: 'Alice', repoIds: [1] })

    for (const productId of [bobs, 'nope']) {
      const res = await post(aliceToken, { productId })
      assert.equal(res.status, 404)
      assert.deepEqual(await res.json(), { error: 'product_not_found' })
    }
    const none = await post(aliceToken, { productId: empty })
    assert.equal(none.status, 409)
    assert.deepEqual(await none.json(), { error: 'product_has_no_repositories' })
    assert.equal(t.db.row<{ n: number }>('SELECT COUNT(*) AS n FROM scans')!.n, 0)

    const res = await post(aliceToken, { productId: mine })
    assert.equal(res.status, 202)
    const body = (await res.json()) as { productScanId: string; scanIds: string[]; url: string }
    assert.equal(body.url, `/products/${mine}`)
    assert.equal(body.scanIds.length, 1)
    assert.deepEqual(t.db.row('SELECT user_id, repo_id, product_scan_id FROM scans WHERE id = ?', body.scanIds[0]), { user_id: alice, repo_id: 1, product_scan_id: body.productScanId })

    const list = (await (await listScans({ request: req('/api/scans', { headers: cookie(aliceToken) }), params: {} })).json()) as { productScans: unknown[]; scans: unknown[] }
    assert.equal(list.productScans.length, 1)
    assert.equal(list.scans.length, 1)
  })
})

describe('GET /api/scans/:scanId', () => {
  test('401 / 404 for other users / 200 for the owner', async () => {
    const { alice, bob, aliceToken, bobToken } = await twoUsers()
    const id = await createScan(alice, 1, 'security', 'manual')
    assert.equal((await getScan({ request: req(`/api/scans/${id}`), params: { scanId: id } })).status, 401)

    const other = await getScan({ request: req(`/api/scans/${id}`, { headers: cookie(bobToken) }), params: { scanId: id } })
    assert.equal(other.status, 404, "another user's scan is indistinguishable from a missing one")
    assert.deepEqual(await other.json(), { error: 'not_found' })
    assert.equal((await getScan({ request: req('/api/scans/nope', { headers: cookie(aliceToken) }), params: { scanId: 'nope' } })).status, 404)

    const res = await getScan({ request: req(`/api/scans/${id}`, { headers: cookie(aliceToken) }), params: { scanId: id } })
    assert.equal(res.status, 200)
    const detail = (await res.json()) as { scan: Record<string, unknown>; events: unknown[]; findings: unknown[]; questions: unknown[]; skills: unknown[]; profile: unknown; codexTasks: unknown[] }
    assert.equal(detail.scan.id, id)
    assert.equal(detail.scan.repo, 'alice/app')
    assert.equal('state_json' in detail.scan, false, 'internal state is not exposed')
    assert.deepEqual(Object.keys(detail).sort(), ['codexTasks', 'events', 'findings', 'profile', 'questions', 'scan', 'skills'])
    assert.equal(detail.events.length, 1)
    void bob
  })
})

describe('actions are scoped by user_id', () => {
  async function seed() {
    const u = await twoUsers()
    const scan = await createScan(u.bob, 2, 'security', 'manual')
    const product = await saveProduct(u.bob, { name: 'Bob app', repoIds: [2] })
    const ts = Date.now()
    t.db.write(
      `INSERT INTO findings (id, scan_id, repo_id, user_id, severity, category, title, description, fingerprint, status, created_at) VALUES ('f-bob', ?, 2, ?, 'high', 'code', 'SQLi', 'd', 'fp', 'open', ?)`,
      scan,
      u.bob,
      ts,
    )
    t.db.write(
      `INSERT INTO questions (id, user_id, repo_id, scan_id, question, status, created_at, product_id) VALUES ('q-bob', ?, 2, ?, 'Is it public?', 'open', ?, ?)`,
      u.bob,
      scan,
      ts,
      product,
    )
    return { ...u, product }
  }

  test('startScanFor only starts scans of repositories linked to the user (by id)', async () => {
    const { alice, bob } = await twoUsers()
    for (const [user, ref] of [[alice, 2], [alice, '2'], [bob, 1]] as const) {
      const r = await startScanFor(user, ref, 'understand')
      assert.equal(r.ok, false)
      assert.equal(!r.ok && r.error, 'not_found')
    }
    assert.equal(t.db.row<{ n: number }>('SELECT COUNT(*) AS n FROM scans')!.n, 0)
    const r = await startScanFor(alice, 1)
    assert.ok(r.ok)
    assert.equal(r.repo, 'alice/app')
    assert.equal(scanRow(t, r.id).kind, 'security')
  })

  test('setFindingStatus', async () => {
    const { alice, bob } = await seed()
    assert.equal(await setFindingStatus(alice, 'f-bob', 'dismissed'), false)
    assert.equal(t.db.row<{ status: string }>(`SELECT status FROM findings WHERE id = 'f-bob'`)!.status, 'open')
    assert.equal(await setFindingStatus(bob, 'f-bob', 'fixed'), true)
    assert.equal(t.db.row<{ status: string }>(`SELECT status FROM findings WHERE id = 'f-bob'`)!.status, 'fixed')
    assert.equal(await setFindingStatus(bob, 'missing', 'fixed'), false)
  })

  test('answerQuestionFor records the answer and turns it into product memory', async () => {
    const { alice, bob, product } = await seed()
    assert.equal(await answerQuestionFor(alice, 'q-bob', 'yes'), false)
    assert.deepEqual(t.db.row(`SELECT status, answer FROM questions WHERE id = 'q-bob'`), { status: 'open', answer: null })
    assert.equal(t.db.row<{ n: number }>('SELECT COUNT(*) AS n FROM memory')!.n, 0)

    assert.equal(await answerQuestionFor(bob, 'q-bob', 'Only on the VPN'), true)
    const q = t.db.row<{ status: string; answer: string; answer_source: string; answered_at: number }>(`SELECT * FROM questions WHERE id = 'q-bob'`)!
    assert.deepEqual([q.status, q.answer, q.answer_source], ['answered', 'Only on the VPN', 'user'])
    assert.ok(q.answered_at)
    assert.deepEqual(t.db.rows('SELECT product_id, kind, content, evidence FROM memory'), [
      { product_id: product, kind: 'fact', content: 'Owner: Is it public? → Only on the VPN', evidence: 'answered by the owner' },
    ])
  })
})
