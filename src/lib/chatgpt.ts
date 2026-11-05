/**
 * Login with ChatGPT (opencoredev/login-with-chatgpt) wiring.
 *
 * - The SDK handler is mounted at /api/chatgpt/* (see src/routes/api/chatgpt/$.ts).
 * - Its session store is a D1 table, so sessions survive isolates/deploys.
 * - Tokens never leave the SDK: for background scans we keep the user's signed
 *   SDK session cookie (encrypted) and replay it through `auth.proxyFetch()`,
 *   which calls the handler in-process. No raw bearer token is ever exported.
 */
import { createChatGPTHandler, type ChatGPTHandler } from '@opencoredev/loginwithchatgpt-server'
import { createChatGPTProxyProvider } from '@opencoredev/loginwithchatgpt-ai'
import { appUrl, str } from './env'
import { decrypt, encrypt } from './crypto'
import { first, now, run } from './db'
import type { UserRow } from './types'

export const LWC_COOKIE = 'lwc_session'
export const PREFERRED_MODELS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5.4-mini', 'gpt-5-mini']

/** KeyValueStore implementation on D1. */
const d1Store = {
  async get(key: string) {
    const row = await first<{ value: string; expires_at: number | null }>('SELECT value, expires_at FROM lwc_store WHERE key = ?', key)
    if (!row) return undefined
    if (row.expires_at && row.expires_at < now()) {
      await run('DELETE FROM lwc_store WHERE key = ?', key)
      return undefined
    }
    return JSON.parse(row.value)
  },
  async set(key: string, value: unknown, options?: { ttlMs?: number }) {
    await run(
      `INSERT INTO lwc_store (key, value, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
      key,
      JSON.stringify(value),
      options?.ttlMs ? now() + options.ttlMs : null,
    )
  },
  async delete(key: string) {
    await run('DELETE FROM lwc_store WHERE key = ?', key)
  },
}

let handler: ChatGPTHandler | undefined
export function chatgptAuth(): ChatGPTHandler {
  handler ??= createChatGPTHandler({
    secret: str('LWC_SECRET') || undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sessionStore: d1Store as any,
    responsesProxy: {
      // Background scans make many calls in a burst; keep a sane ceiling.
      rateLimit: { limit: 120, windowMs: 60_000 },
    },
    instructions: 'You are openscan, a meticulous application-security reviewer. Reply with exactly what is asked.',
  })
  return handler
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return undefined
}

/** Links the browser's authenticated ChatGPT session to the signed-in openscan user. */
export async function linkChatGPT(request: Request, user: UserRow) {
  const session = await chatgptAuth().getSession(request)
  const cookie = readCookie(request, LWC_COOKIE)
  if (session.status !== 'authenticated' || !cookie) return { linked: false as const, status: session.status }
  await run(
    'UPDATE users SET chatgpt_cookie_enc = ?, chatgpt_email = ?, chatgpt_plan = ?, updated_at = ? WHERE id = ?',
    await encrypt(cookie),
    session.user?.email ?? null,
    session.user?.plan ?? null,
    now(),
    user.id,
  )
  return { linked: true as const, email: session.user?.email ?? null, plan: session.user?.plan ?? null }
}

export async function unlinkChatGPT(userId: string) {
  await run('UPDATE users SET chatgpt_cookie_enc = NULL, chatgpt_email = NULL, chatgpt_plan = NULL WHERE id = ?', userId)
}

/** A synthetic request carrying the user's SDK session cookie, for server-side use. */
async function syntheticRequest(user: Pick<UserRow, 'chatgpt_cookie_enc'>): Promise<Request | null> {
  const cookie = await decrypt(user.chatgpt_cookie_enc)
  if (!cookie) return null
  return new Request(`${appUrl()}/`, { headers: { cookie: `${LWC_COOKIE}=${cookie}` } })
}

export interface BackgroundLLM {
  provider: ReturnType<typeof createChatGPTProxyProvider>
  model: string
}

/**
 * Returns an AI SDK provider bound to the user's ChatGPT plan, or null when the
 * user never linked ChatGPT / the session expired.
 */
export async function backgroundLLM(user: Pick<UserRow, 'chatgpt_cookie_enc'>): Promise<BackgroundLLM | null> {
  const req = await syntheticRequest(user)
  if (!req) return null
  const auth = chatgptAuth()
  const session = await auth.getSession(req)
  if (session.status !== 'authenticated') return null
  const models = (await auth.getModels(req).catch(() => undefined)) ?? []
  const model = PREFERRED_MODELS.find((m) => models.includes(m)) ?? models[0]
  if (!model) return null
  const provider = createChatGPTProxyProvider({
    basePath: `${appUrl()}/api/chatgpt`,
    fetch: auth.proxyFetch(req),
  })
  return { provider, model }
}
