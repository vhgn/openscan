import { deleteCookie, getCookie, getRequest, setCookie } from '@tanstack/react-start/server'
import { first, now, run } from './db'
import { randomToken, sha256Hex } from './crypto'
import type { UserRow } from './types'

const COOKIE = 'openscan_session'
const TTL_MS = 30 * 24 * 60 * 60 * 1000

function secure(): boolean {
  try {
    return new URL(getRequest().url).protocol === 'https:'
  } catch {
    return false
  }
}

export async function createSession(userId: string): Promise<string> {
  const token = randomToken()
  await run(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    await sha256Hex(token),
    userId,
    now() + TTL_MS,
    now(),
  )
  return token
}

export function sessionCookieHeader(token: string, requestUrl: string): string {
  const isSecure = new URL(requestUrl).protocol === 'https:'
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}${isSecure ? '; Secure' : ''}`
}

export function clearSessionCookieHeader(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

function readCookieFrom(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

export async function userFromRequest(request: Request): Promise<UserRow | null> {
  const token = readCookieFrom(request, COOKIE)
  return token ? userFromToken(token) : null
}

async function userFromToken(token: string): Promise<UserRow | null> {
  const id = await sha256Hex(token)
  return first<UserRow>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`,
    id,
    now(),
  )
}

/** For use inside server functions. */
export async function currentUser(): Promise<UserRow | null> {
  const token = getCookie(COOKIE)
  return token ? userFromToken(token) : null
}

export async function requireUser(): Promise<UserRow> {
  const user = await currentUser()
  if (!user) throw new Error('UNAUTHENTICATED')
  return user
}

export async function destroyCurrentSession(): Promise<void> {
  const token = getCookie(COOKIE)
  if (token) await run('DELETE FROM sessions WHERE id = ?', await sha256Hex(token))
  deleteCookie(COOKIE, { path: '/' })
}

export function setSessionCookie(token: string) {
  setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: TTL_MS / 1000, secure: secure() })
}
