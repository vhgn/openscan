/**
 * GitHub App plumbing: app JWT (RS256 via WebCrypto), installation tokens,
 * and user-to-server OAuth ("Login with GitHub" through the GitHub App).
 */
import { appUrl, str } from '../env'
import { b64url, decrypt, encrypt } from '../crypto'
import { now, run } from '../db'
import type { UserRow } from '../types'

const enc = new TextEncoder()

import { pemToPkcs8 } from './pem'

let signingKey: CryptoKey | undefined
async function getSigningKey(): Promise<CryptoKey> {
  if (signingKey) return signingKey
  const pem = str('GITHUB_APP_PRIVATE_KEY')
  if (!pem) throw new Error('GITHUB_APP_PRIVATE_KEY is not configured')
  signingKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return signingKey
}

export async function appJwt(): Promise<string> {
  const iat = Math.floor(Date.now() / 1000) - 60
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = b64url(enc.encode(JSON.stringify({ iat, exp: iat + 9 * 60, iss: str('GITHUB_APP_ID') })))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await getSigningKey(), enc.encode(`${header}.${payload}`))
  return `${header}.${payload}.${b64url(sig)}`
}

// ---------- low-level fetch ----------

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function gh<T>(path: string, token: string | null, init: RequestInit & { raw?: boolean } = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`
  const headers = new Headers(init.headers)
  headers.set('accept', init.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json')
  headers.set('x-github-api-version', '2022-11-28')
  headers.set('user-agent', 'openscan')
  // Public demo repos have no installation token; GITHUB_PUBLIC_TOKEN (optional, dev only) lifts the 60 req/h anonymous limit.
  const auth = token ?? (str('GITHUB_PUBLIC_TOKEN') || null)
  if (auth) headers.set('authorization', `Bearer ${auth}`)
  const res = await fetch(url, { ...init, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new GitHubError(`GitHub ${res.status} for ${path}: ${text.slice(0, 300)}`, res.status)
  }
  if (init.raw) return (await res.text()) as T
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// ---------- installation tokens ----------

const installationTokens = new Map<number, { token: string; expiresAt: number }>()

export async function installationToken(installationId: number): Promise<string> {
  const cached = installationTokens.get(installationId)
  if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token
  const res = await gh<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    await appJwt(),
    { method: 'POST' },
  )
  installationTokens.set(installationId, { token: res.token, expiresAt: Date.parse(res.expires_at) })
  return res.token
}

// ---------- user OAuth (GitHub App user-to-server tokens) ----------

export function githubConfigured(): boolean {
  return Boolean(str('GITHUB_CLIENT_ID') && str('GITHUB_CLIENT_SECRET'))
}

export function authorizeUrl(state: string): string {
  const u = new URL('https://github.com/login/oauth/authorize')
  u.searchParams.set('client_id', str('GITHUB_CLIENT_ID'))
  u.searchParams.set('redirect_uri', `${appUrl()}/api/auth/github/callback`)
  u.searchParams.set('state', state)
  return u.toString()
}

export function installUrl(state?: string): string {
  const u = new URL(`https://github.com/apps/${str('GITHUB_APP_SLUG') || 'openscan'}/installations/new`)
  if (state) u.searchParams.set('state', state)
  return u.toString()
}

export function manageInstallationUrl(installationId: number, accountType: string, accountLogin: string): string {
  return accountType === 'Organization'
    ? `https://github.com/organizations/${accountLogin}/settings/installations/${installationId}`
    : `https://github.com/settings/installations/${installationId}`
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'openscan' },
    body: JSON.stringify({ client_id: str('GITHUB_CLIENT_ID'), client_secret: str('GITHUB_CLIENT_SECRET'), ...params }),
  })
  return (await res.json()) as TokenResponse
}

export async function exchangeCode(code: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
  const t = await tokenRequest({ code, redirect_uri: `${appUrl()}/api/auth/github/callback` })
  if (!t.access_token) throw new Error(t.error_description || t.error || 'GitHub token exchange failed')
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined,
  }
}

export async function storeUserToken(userId: string, tok: { accessToken: string; refreshToken?: string; expiresAt?: number }) {
  await run(
    'UPDATE users SET gh_token_enc = ?, gh_refresh_enc = ?, gh_token_expires_at = ?, updated_at = ? WHERE id = ?',
    await encrypt(tok.accessToken),
    tok.refreshToken ? await encrypt(tok.refreshToken) : null,
    tok.expiresAt ?? null,
    now(),
    userId,
  )
}

/** Returns a valid user-to-server token, refreshing it when it has expired. */
export async function userToken(user: UserRow): Promise<string | null> {
  const access = await decrypt(user.gh_token_enc)
  if (!access) return null
  if (!user.gh_token_expires_at || user.gh_token_expires_at - 60_000 > Date.now()) return access
  const refresh = await decrypt(user.gh_refresh_enc)
  if (!refresh) return null
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh })
  if (!t.access_token) return null
  const next = {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined,
  }
  await storeUserToken(user.id, next)
  return next.accessToken
}
