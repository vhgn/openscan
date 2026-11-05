/**
 * Test harness for code that runs inside the Worker:
 *
 * - `cloudflare:workers` is redirected to ./cloudflare-workers.mjs by ./register.mjs
 *   (see the "test" npm script), so `env` below is the very object src/lib/env.ts reads.
 *   resetEnv() refills it with a fresh in-memory D1 (./d1.ts), a recording queue
 *   stub for the JOBS binding, and test vars/secrets.
 * - stubFetch() replaces globalThis.fetch with a route table. Any request without a
 *   route throws AND is recorded in `unexpected`, so tests fail loudly on real network use
 *   (assertNoUnexpectedFetch), even where src swallows fetch errors.
 * - Fixture helpers insert users/repos/preferences the way the app stores them.
 *
 * This module deliberately imports nothing from src/, so a test can mock a src module
 * (node:test mock.module) before the app code is first loaded.
 */
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { env } from 'cloudflare:workers'
import { TestD1 } from './d1.ts'

export interface QueuedJob {
  scanId: string
  delaySeconds?: number
}

export interface TestEnv {
  db: TestD1
  /** Messages sent to env.JOBS, in order. */
  queue: QueuedJob[]
}

export const WEBHOOK_SECRET = 'test-webhook-secret'
export const APP_URL = 'https://openscan.test'

/** Fresh database + bindings. Call in beforeEach. */
export function resetEnv(vars: Record<string, string> = {}): TestEnv {
  const db = new TestD1()
  const queue: QueuedJob[] = []
  const e = env as unknown as Record<string, unknown>
  for (const k of Object.keys(e)) delete e[k]
  Object.assign(e, {
    DB: db,
    JOBS: {
      async send(body: { scanId: string }, opts?: { delaySeconds?: number }) {
        queue.push({ scanId: body.scanId, ...(opts?.delaySeconds ? { delaySeconds: opts.delaySeconds } : {}) })
      },
    },
    APP_URL,
    AI_MODE: 'auto',
    SESSION_SECRET: 'test-session-secret',
    GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...vars,
  })
  return { db, queue }
}

/** Runs queued steps until the queue is empty (guarded against runaway loops). */
export async function drain(t: TestEnv, runStep: (scanId: string) => Promise<void>, maxSteps = 200): Promise<string[]> {
  const ran: string[] = []
  while (t.queue.length) {
    assert.ok(ran.length < maxSteps, `queue did not drain within ${maxSteps} steps`)
    const job = t.queue.shift()!
    ran.push(job.scanId)
    await runStep(job.scanId)
  }
  return ran
}

// ---------------------------------------------------------------- fetch stub

type Responder = (req: Request, match: RegExpMatchArray) => Response | Promise<Response>

export interface FetchStub {
  /** Registers a route; the most recently added matching route wins. */
  on(method: string, url: string | RegExp, respond: Responder): void
  calls: string[]
  unexpected: string[]
  restore(): void
}

export function stubFetch(): FetchStub {
  const routes: Array<{ method: string; url: string | RegExp; respond: Responder }> = []
  const calls: string[] = []
  const unexpected: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    calls.push(`${req.method} ${req.url}`)
    for (const r of [...routes].reverse()) {
      if (r.method !== req.method) continue
      const m = typeof r.url === 'string' ? (r.url === req.url ? ([req.url] as RegExpMatchArray) : null) : req.url.match(r.url)
      if (m) return r.respond(req, m)
    }
    unexpected.push(`${req.method} ${req.url}`)
    throw new Error(`Unexpected fetch in test: ${req.method} ${req.url}`)
  }) as typeof fetch
  return {
    on: (method, url, respond) => void routes.push({ method, url, respond }),
    calls,
    unexpected,
    restore: () => void (globalThis.fetch = original),
  }
}

export function assertNoUnexpectedFetch(f: FetchStub) {
  assert.deepEqual(f.unexpected, [], 'code under test made network requests the test did not stub')
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Git blob sha, like GitHub's tree API returns. */
export function blobSha(content: string): string {
  return createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex')
}

/**
 * Serves a repository the way src/lib/github/repos.ts reads a token-less (public)
 * repo: repo metadata and the git ref/tree from api.github.com, file bodies from
 * raw.githubusercontent.com.
 */
export function serveRepo(f: FetchStub, opts: { fullName: string; id?: number; branch?: string; sha?: string; files: Record<string, string>; private?: boolean }) {
  const branch = opts.branch ?? 'main'
  const sha = opts.sha ?? 'c0ffee0000000000000000000000000000000001'
  const api = `https://api.github.com/repos/${opts.fullName}`
  f.on('GET', api, () =>
    Response.json({
      id: opts.id ?? 4242,
      full_name: opts.fullName,
      default_branch: branch,
      private: opts.private ?? false,
      html_url: `https://github.com/${opts.fullName}`,
      description: null,
      language: 'TypeScript',
    }),
  )
  f.on('GET', `${api}/git/ref/heads/${branch}`, () => Response.json({ object: { sha } }))
  f.on('GET', `${api}/git/trees/${sha}?recursive=1`, () =>
    Response.json({
      truncated: false,
      tree: Object.entries(opts.files).map(([path, content]) => ({ path, type: 'blob', size: Buffer.byteLength(content), sha: blobSha(content) })),
    }),
  )
  f.on('GET', new RegExp(`^https://raw\\.githubusercontent\\.com/${esc(opts.fullName)}/${sha}/(.+)$`), (_req, m) => {
    const path = m[1].split('/').map(decodeURIComponent).join('/')
    return path in opts.files ? new Response(opts.files[path]) : new Response('404: Not Found', { status: 404 })
  })
}

/** OSV.dev: no known vulnerabilities for anything, unless `vulns` names "name@version". */
export function serveOsv(f: FetchStub, vulns: Record<string, { id: string; summary: string; severity?: string; fixed?: string }> = {}) {
  f.on('POST', 'https://api.osv.dev/v1/querybatch', async (req) => {
    const body = (await req.json()) as { queries: Array<{ package: { name: string }; version: string }> }
    return Response.json({
      results: body.queries.map((q) => {
        const v = vulns[`${q.package.name}@${q.version}`]
        return v ? { vulns: [{ id: v.id }] } : {}
      }),
    })
  })
  f.on('GET', /^https:\/\/api\.osv\.dev\/v1\/vulns\/(.+)$/, (_req, m) => {
    const v = Object.values(vulns).find((x) => x.id === decodeURIComponent(m[1]))
    if (!v) return new Response('not found', { status: 404 })
    return Response.json({
      id: v.id,
      summary: v.summary,
      database_specific: { severity: v.severity ?? 'HIGH' },
      affected: v.fixed ? [{ ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: v.fixed }] }] }] : [],
    })
  })
}

// ---------------------------------------------------------------- fixtures

let githubIds = 1000

export function insertUser(t: TestEnv, opts: { login?: string; onboarded?: boolean; chatgpt?: boolean } = {}): string {
  const id = `user-${++githubIds}`
  const ts = Date.now()
  t.db.write(
    `INSERT INTO users (id, github_id, login, onboarding_step, onboarded_at, chatgpt_cookie_enc, created_at, updated_at) VALUES (?, ?, ?, 'done', ?, ?, ?, ?)`,
    id,
    githubIds,
    opts.login ?? id,
    opts.onboarded === false ? null : ts,
    opts.chatgpt ? 'linked-chatgpt-session' : null,
    ts,
    ts,
  )
  return id
}

/** Inserts a repository (public, token-less unless installationId is given) and links it to the users. */
export function insertRepo(
  t: TestEnv,
  opts: { id: number; fullName: string; installationId?: number | null; branch?: string; users?: Array<{ id: string; selected?: boolean }> },
): number {
  const ts = Date.now()
  if (opts.installationId) {
    t.db.write(
      `INSERT OR IGNORE INTO installations (id, account_login, account_type, repository_selection, created_at, updated_at) VALUES (?, ?, 'User', 'selected', ?, ?)`,
      opts.installationId,
      opts.fullName.split('/')[0],
      ts,
      ts,
    )
  }
  t.db.write(
    `INSERT INTO repositories (id, installation_id, full_name, default_branch, private, html_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    opts.id,
    opts.installationId ?? null,
    opts.fullName,
    opts.branch ?? 'main',
    opts.installationId ? 1 : 0,
    `https://github.com/${opts.fullName}`,
    ts,
    ts,
  )
  for (const u of opts.users ?? []) {
    t.db.write('INSERT INTO user_repositories (user_id, repo_id, selected, created_at) VALUES (?, ?, ?, ?)', u.id, opts.id, u.selected === false ? 0 : 1, ts)
    if (opts.installationId) t.db.write('INSERT OR IGNORE INTO user_installations (user_id, installation_id) VALUES (?, ?)', u.id, opts.installationId)
  }
  return opts.id
}

export function setPreferences(t: TestEnv, userId: string, prefs: Record<string, unknown>) {
  t.db.write(
    'INSERT INTO preferences (user_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json',
    userId,
    JSON.stringify(prefs),
    Date.now(),
  )
}

export function scanRow(t: TestEnv, scanId: string) {
  return t.db.row<{
    id: string
    status: string
    phase: string
    progress: number
    attempts: number
    lease_id: string | null
    updated_at: number
    engine: string | null
    model: string | null
    trigger: string
    kind: string
    error: string | null
    commit_sha: string | null
    state_json: string
    summary_json: string | null
    skills_json: string | null
    started_at: number | null
    finished_at: number | null
    product_id: string | null
    product_scan_id: string | null
  }>('SELECT * FROM scans WHERE id = ?', scanId)!
}

export function events(t: TestEnv, scanId: string) {
  return t.db.rows<{ level: string; message: string }>('SELECT level, message FROM scan_events WHERE scan_id = ? ORDER BY id', scanId)
}

/** GitHub's X-Hub-Signature-256 for a body. */
export function githubSignature(body: string, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}
