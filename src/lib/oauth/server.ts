/**
 * OAuth 2.1 authorization server protecting the MCP endpoint (/mcp).
 *
 * Implements what the MCP authorization spec asks of a server:
 *   - RFC 9728 protected resource metadata   GET /.well-known/oauth-protected-resource[/mcp]
 *   - RFC 8414 authorization server metadata GET /.well-known/oauth-authorization-server
 *   - RFC 7591 dynamic client registration   POST /oauth/register
 *   - Client ID Metadata Documents           (https URL as client_id, fetched and cached)
 *   - Authorization code + PKCE (S256 only)  GET/POST /oauth/authorize
 *   - Token endpoint with refresh rotation   POST /oauth/token
 *   - RFC 7009 revocation                    POST /oauth/revoke
 *   - RFC 8707 resource indicators           tokens are bound to APP_URL/mcp
 *
 * Users sign in with the app's normal GitHub login; the consent page is served here.
 * Everything lives in D1 (migrations/0005_mcp_oauth.sql); secrets are stored hashed.
 */
import { all, first, now, parseJson, run, uid } from '../db'
import { appUrl } from '../env'
import { randomToken, sha256Hex } from '../crypto'
import { userFromRequest } from '../session'
import type { UserRow } from '../types'
import {
  ACCESS_TOKEN_TTL_S,
  ALL_SCOPES,
  CODE_TTL_S,
  REFRESH_TOKEN_TTL_S,
  REQUEST_TTL_S,
  authorizationServerMetadata,
  isMetadataDocumentClientId,
  issuerUrls,
  parseScope,
  protectedResourceMetadata,
  redirectUriMatches,
  resourceMatches,
  validRedirectUri,
  verifyPkce,
  type Scope,
} from './core'
import { consentPage, errorPage, pageHeaders } from './pages'

// ------------------------------------------------------------------ http helpers

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id, mcp-protocol-version',
  'access-control-max-age': '86400',
}

/** Bearer-token endpoints (no cookies involved) are safe to open to any origin, which browser-based MCP clients need. */
export function withCors(res: Response): Response {
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v)
  return out
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS })
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return withCors(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', pragma: 'no-cache', ...extra },
    }),
  )
}

function oauthError(error: string, description: string, status = 400, extra: Record<string, string> = {}): Response {
  return json({ error, error_description: description }, status, extra)
}

function html(body: string, status = 200): Response {
  return new Response(body, pageHeaders(status))
}

async function readParams(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get('content-type') ?? ''
  const text = await request.text()
  if (type.includes('application/json')) {
    const obj = parseJson<Record<string, unknown>>(text, {})
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') p.set(k, v)
    return p
  }
  return new URLSearchParams(text)
}

// ------------------------------------------------------------------ clients

interface ClientRow {
  id: string
  secret_hash: string | null
  name: string | null
  uri: string | null
  redirect_uris: string
  token_endpoint_auth_method: string
  source: string
  created_at: number
  updated_at: number
}

export interface OAuthClient {
  id: string
  secretHash: string | null
  name: string | null
  uri: string | null
  redirectUris: string[]
  authMethod: string
}

function toClient(row: ClientRow): OAuthClient {
  return {
    id: row.id,
    secretHash: row.secret_hash,
    name: row.name,
    uri: row.uri,
    redirectUris: parseJson<string[]>(row.redirect_uris, []),
    authMethod: row.token_endpoint_auth_method,
  }
}

function cleanText(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

function cleanUri(v: unknown): string | null {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

const METADATA_TTL_MS = 60 * 60 * 1000

/** Fetches (and caches for an hour) the Client ID Metadata Document a URL client_id points to. */
async function metadataDocumentClient(clientId: string): Promise<OAuthClient | null> {
  const cached = await first<ClientRow>(`SELECT * FROM oauth_clients WHERE id = ? AND source = 'metadata_document'`, clientId)
  if (cached && cached.updated_at > now() - METADATA_TTL_MS) return toClient(cached)
  let doc: Record<string, unknown>
  try {
    const res = await fetch(clientId, {
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    })
    if (res.status !== 200) return null
    const text = await res.text()
    if (text.length > 20_000) return null
    doc = JSON.parse(text)
  } catch {
    return null
  }
  const redirectUris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter((u): u is string => typeof u === 'string') : []
  const method = typeof doc.token_endpoint_auth_method === 'string' ? doc.token_endpoint_auth_method : 'none'
  if (doc.client_id !== clientId || !redirectUris.length || !redirectUris.every(validRedirectUri) || method !== 'none') return null
  const row: ClientRow = {
    id: clientId,
    secret_hash: null,
    name: cleanText(doc.client_name, 100),
    uri: cleanUri(doc.client_uri),
    redirect_uris: JSON.stringify(redirectUris.slice(0, 20)),
    token_endpoint_auth_method: 'none',
    source: 'metadata_document',
    created_at: cached?.created_at ?? now(),
    updated_at: now(),
  }
  await run(
    `INSERT INTO oauth_clients (id, secret_hash, name, uri, redirect_uris, token_endpoint_auth_method, source, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?, 'none', 'metadata_document', ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, uri = excluded.uri, redirect_uris = excluded.redirect_uris, updated_at = excluded.updated_at`,
    row.id,
    row.name,
    row.uri,
    row.redirect_uris,
    row.created_at,
    row.updated_at,
  )
  return toClient(row)
}

export async function getClient(clientId: string | null | undefined): Promise<OAuthClient | null> {
  if (!clientId || clientId.length > 2048) return null
  if (isMetadataDocumentClientId(clientId)) return metadataDocumentClient(clientId)
  const row = await first<ClientRow>(`SELECT * FROM oauth_clients WHERE id = ? AND source = 'dcr'`, clientId)
  return row ? toClient(row) : null
}

/** RFC 7591 dynamic client registration (open, as MCP clients expect). */
async function register(request: Request): Promise<Response> {
  const body = parseJson<Record<string, unknown>>(await request.text(), {})
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : []
  if (!redirectUris.length || redirectUris.length > 10 || !redirectUris.every((u) => typeof u === 'string' && validRedirectUri(u))) {
    return oauthError('invalid_redirect_uri', 'redirect_uris must be https, http on a loopback address, or a private-use scheme')
  }
  const method = typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'client_secret_basic'
  if (!['none', 'client_secret_basic', 'client_secret_post'].includes(method)) {
    return oauthError('invalid_client_metadata', `token_endpoint_auth_method ${method} is not supported`)
  }
  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code']
  if (!grantTypes.every((g) => g === 'authorization_code' || g === 'refresh_token')) {
    return oauthError('invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported')
  }
  const responseTypes = Array.isArray(body.response_types) ? body.response_types : ['code']
  if (!responseTypes.every((r) => r === 'code')) return oauthError('invalid_client_metadata', 'Only the code response type is supported')

  const clientId = `osc_${randomToken(18)}`
  const secret = method === 'none' ? null : `oss_${randomToken(32)}`
  const name = cleanText(body.client_name, 100)
  const uri = cleanUri(body.client_uri)
  const issuedAt = now()
  await run(
    `INSERT INTO oauth_clients (id, secret_hash, name, uri, redirect_uris, token_endpoint_auth_method, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'dcr', ?, ?)`,
    clientId,
    secret ? await sha256Hex(secret) : null,
    name,
    uri,
    JSON.stringify(redirectUris),
    method,
    issuedAt,
    issuedAt,
  )
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(issuedAt / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: name ?? undefined,
      client_uri: uri ?? undefined,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: method,
      grant_types: grantTypes,
      response_types: ['code'],
      scope: ALL_SCOPES.join(' '),
    },
    201,
  )
}

/** Client authentication at the token and revocation endpoints. */
async function authenticateClient(request: Request, params: URLSearchParams): Promise<OAuthClient | Response> {
  let id = params.get('client_id')
  let secret = params.get('client_secret')
  const basic = request.headers.get('authorization')?.match(/^Basic\s+(.+)$/i)?.[1]
  if (basic) {
    try {
      const [rawId, ...rest] = atob(basic).split(':')
      id = decodeURIComponent(rawId ?? '')
      secret = decodeURIComponent(rest.join(':'))
    } catch {
      return oauthError('invalid_client', 'Malformed Basic credentials', 401)
    }
  }
  const client = await getClient(id)
  if (!client) return oauthError('invalid_client', 'Unknown client', 401)
  if (client.secretHash) {
    if (!secret || (await sha256Hex(secret)) !== client.secretHash) return oauthError('invalid_client', 'Client authentication failed', 401)
  }
  return client
}

// ------------------------------------------------------------------ authorize

interface AuthorizeParams {
  clientId: string
  redirectUri: string
  state: string | null
  scopes: Scope[]
  codeChallenge: string
  resource: string
}

function redirectWith(redirectUri: string, params: Record<string, string | null>): Response {
  const url = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v)
  url.searchParams.set('iss', issuerUrls(appUrl()).issuer)
  return new Response(null, { status: 302, headers: { location: url.toString(), 'cache-control': 'no-store' } })
}

async function authorizeGet(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const q = url.searchParams
  const client = await getClient(q.get('client_id'))
  if (!client) return html(errorPage('Unknown app', 'This app is not registered with openscan, or its client metadata could not be loaded.'), 400)

  let redirectUri = q.get('redirect_uri')
  if (!redirectUri && client.redirectUris.length === 1) redirectUri = client.redirectUris[0]!
  if (!redirectUri || !redirectUriMatches(client.redirectUris, redirectUri)) {
    return html(errorPage('Redirect not allowed', 'The redirect address does not match the ones this app registered.'), 400)
  }

  // From here on, errors go back to the client.
  const state = q.get('state')
  const fail = (error: string, description: string) => redirectWith(redirectUri, { error, error_description: description, state })
  if (q.get('response_type') !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported')
  const challenge = q.get('code_challenge')
  if (!challenge || q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required')
  }
  const scopes = parseScope(q.get('scope'))
  if (!scopes) return fail('invalid_scope', `Supported scopes: ${ALL_SCOPES.join(' ')}`)
  const { resource } = issuerUrls(appUrl())
  if (!resourceMatches(q.get('resource'), resource)) return fail('invalid_target', `This server only issues tokens for ${resource}`)

  const user = await userFromRequest(request)
  if (!user) {
    const next = `${url.pathname}${url.search}`
    return new Response(null, { status: 302, headers: { location: `/api/auth/github/login?next=${encodeURIComponent(next)}` } })
  }

  const params: AuthorizeParams = { clientId: client.id, redirectUri, state, scopes, codeChallenge: challenge, resource }
  const requestId = randomToken(24)
  await run(
    'INSERT INTO oauth_requests (id, user_id, client_id, params_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    await sha256Hex(requestId),
    user.id,
    client.id,
    JSON.stringify(params),
    now() + REQUEST_TTL_S * 1000,
    now(),
  )
  return html(
    consentPage({
      requestId,
      clientName: client.name,
      clientId: client.id,
      clientUri: client.uri,
      redirectUri,
      scopes,
      login: user.login,
    }),
  )
}

async function authorizePost(request: Request): Promise<Response> {
  // Defense in depth on top of SameSite=Lax session cookies: the form must come from our own origin.
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(appUrl()).origin && origin !== new URL(request.url).origin) {
    return html(errorPage('Request blocked', 'This approval did not come from openscan.'), 403)
  }
  const user = await userFromRequest(request)
  if (!user) return html(errorPage('Signed out', 'Your session ended before you approved the connection.'), 401)
  const form = new URLSearchParams(await request.text())
  const requestId = form.get('request_id') ?? ''
  const pending = await first<{ params_json: string; expires_at: number }>(
    'DELETE FROM oauth_requests WHERE id = ? AND user_id = ? RETURNING params_json, expires_at',
    await sha256Hex(requestId),
    user.id,
  )
  if (!pending || pending.expires_at < now()) {
    return html(errorPage('Request expired', 'This approval link has expired or was already used.'), 400)
  }
  const p = parseJson<AuthorizeParams | null>(pending.params_json, null)
  if (!p) return html(errorPage('Request invalid', 'The authorization request could not be read.'), 400)
  if (form.get('decision') !== 'approve') {
    return redirectWith(p.redirectUri, { error: 'access_denied', error_description: 'The user denied the request', state: p.state })
  }
  const code = randomToken(32)
  await run(
    `INSERT INTO oauth_codes (id, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    await sha256Hex(code),
    p.clientId,
    user.id,
    p.redirectUri,
    p.codeChallenge,
    p.scopes.join(' '),
    p.resource,
    now() + CODE_TTL_S * 1000,
    now(),
  )
  return redirectWith(p.redirectUri, { code, state: p.state })
}

// ------------------------------------------------------------------ tokens

/** Access token carries `scope` (possibly narrowed on refresh); the refresh token keeps the full grant scope. */
async function issueTokens(grantId: string, grantScope: string, scope = grantScope): Promise<Response> {
  const access = `os_at_${randomToken(32)}`
  const refresh = `os_rt_${randomToken(32)}`
  const t = now()
  await run(
    `INSERT INTO oauth_tokens (id, grant_id, kind, scope, expires_at, created_at) VALUES (?, ?, 'access', ?, ?, ?), (?, ?, 'refresh', ?, ?, ?)`,
    await sha256Hex(access),
    grantId,
    scope,
    t + ACCESS_TOKEN_TTL_S * 1000,
    t,
    await sha256Hex(refresh),
    grantId,
    grantScope,
    t + REFRESH_TOKEN_TTL_S * 1000,
    t,
  )
  return json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_S, refresh_token: refresh, scope })
}

async function token(request: Request): Promise<Response> {
  const params = await readParams(request)
  const client = await authenticateClient(request, params)
  if (client instanceof Response) return client
  const { resource } = issuerUrls(appUrl())
  if (!resourceMatches(params.get('resource'), resource)) return oauthError('invalid_target', `This server only issues tokens for ${resource}`)

  const grantType = params.get('grant_type')
  if (grantType === 'authorization_code') {
    const codeValue = params.get('code') ?? ''
    // DELETE … RETURNING makes the code single-use even under concurrent requests.
    const code = await first<{ client_id: string; user_id: string; redirect_uri: string; code_challenge: string; scope: string; resource: string; expires_at: number }>(
      'DELETE FROM oauth_codes WHERE id = ? RETURNING client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at',
      await sha256Hex(codeValue),
    )
    if (!code || code.expires_at < now() || code.client_id !== client.id) return oauthError('invalid_grant', 'The authorization code is invalid or expired')
    if (params.get('redirect_uri') && params.get('redirect_uri') !== code.redirect_uri) return oauthError('invalid_grant', 'redirect_uri does not match the authorization request')
    if (!(await verifyPkce(params.get('code_verifier') ?? '', code.code_challenge))) return oauthError('invalid_grant', 'PKCE verification failed')
    const grantId = uid()
    await run(
      'INSERT INTO oauth_grants (id, user_id, client_id, scope, resource, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      grantId,
      code.user_id,
      client.id,
      code.scope,
      code.resource,
      now(),
      now(),
    )
    return issueTokens(grantId, code.scope)
  }

  if (grantType === 'refresh_token') {
    const old = await first<{ grant_id: string; expires_at: number }>(
      `DELETE FROM oauth_tokens WHERE id = ? AND kind = 'refresh' RETURNING grant_id, expires_at`,
      await sha256Hex(params.get('refresh_token') ?? ''),
    )
    const grant = old ? await first<{ id: string; client_id: string; scope: string }>('SELECT id, client_id, scope FROM oauth_grants WHERE id = ?', old.grant_id) : null
    if (!old || !grant || old.expires_at < now() || grant.client_id !== client.id) return oauthError('invalid_grant', 'The refresh token is invalid or expired')
    let scope = grant.scope
    const asked = params.get('scope')
    if (asked) {
      const granted = grant.scope.split(' ')
      const narrowed = asked.split(/\s+/).filter(Boolean)
      if (!narrowed.every((s) => granted.includes(s))) return oauthError('invalid_scope', 'Cannot widen the granted scope')
      scope = narrowed.join(' ')
    }
    await run('UPDATE oauth_grants SET last_used_at = ? WHERE id = ?', now(), grant.id)
    return issueTokens(grant.id, grant.scope, scope)
  }

  return oauthError('unsupported_grant_type', 'Supported grants: authorization_code, refresh_token')
}

/** RFC 7009. Revoking a refresh token disconnects the whole grant. Always 200 for unknown tokens. */
async function revoke(request: Request): Promise<Response> {
  const params = await readParams(request)
  const client = await authenticateClient(request, params)
  if (client instanceof Response) return client
  const row = await first<{ id: string; kind: string; grant_id: string }>(
    `SELECT t.id, t.kind, t.grant_id FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.id = ? AND g.client_id = ?`,
    await sha256Hex(params.get('token') ?? ''),
    client.id,
  )
  if (row?.kind === 'refresh') await run('DELETE FROM oauth_grants WHERE id = ?', row.grant_id)
  else if (row) await run('DELETE FROM oauth_tokens WHERE id = ?', row.id)
  return json({})
}

// ------------------------------------------------------------------ resource server side

export interface McpAuth {
  user: UserRow
  grantId: string
  clientId: string
  scopes: Scope[]
  token: string
  expiresAt: number
}

function challenge(status: 401, error?: string, description?: string): Response {
  const { resourceMetadata } = issuerUrls(appUrl())
  const parts = [`resource_metadata="${resourceMetadata}"`, `scope="${ALL_SCOPES.join(' ')}"`]
  if (error) parts.push(`error="${error}"`)
  if (description) parts.push(`error_description="${description}"`)
  return json(
    { error: error ?? 'unauthorized', error_description: description ?? 'Sign in with OAuth to use the openscan MCP server' },
    status,
    { 'www-authenticate': `Bearer ${parts.join(', ')}` },
  )
}

/** Validates the Bearer token on an MCP request. Returns the caller, or a 401 with the discovery hint. */
export async function authenticateMcp(request: Request): Promise<McpAuth | Response> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return challenge(401)
  const row = await first<{ expires_at: number; grant_id: string; client_id: string; scope: string; resource: string; user_id: string; last_used_at: number | null }>(
    `SELECT t.expires_at, t.scope, g.id AS grant_id, g.client_id, g.resource, g.user_id, g.last_used_at
     FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.id = ? AND t.kind = 'access'`,
    await sha256Hex(token),
  )
  if (!row || row.expires_at < now()) return challenge(401, 'invalid_token', 'The access token is invalid or expired')
  if (!resourceMatches(row.resource, issuerUrls(appUrl()).resource)) return challenge(401, 'invalid_token', 'The access token was issued for another resource')
  const user = await first<UserRow>('SELECT * FROM users WHERE id = ?', row.user_id)
  if (!user) return challenge(401, 'invalid_token', 'The account no longer exists')
  if (!row.last_used_at || row.last_used_at < now() - 5 * 60_000) await run('UPDATE oauth_grants SET last_used_at = ? WHERE id = ?', now(), row.grant_id)
  return {
    user,
    grantId: row.grant_id,
    clientId: row.client_id,
    scopes: ALL_SCOPES.filter((s) => row.scope.split(' ').includes(s)),
    token,
    expiresAt: row.expires_at,
  }
}

// ------------------------------------------------------------------ router, settings, cleanup

/** Handles the OAuth and discovery routes; returns null for anything else. */
export async function handleOAuth(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const m = request.method
  const isOAuthPath = pathname.startsWith('/.well-known/oauth-') || pathname.startsWith('/oauth/')
  if (!isOAuthPath) return null
  if (m === 'OPTIONS' && pathname !== '/oauth/authorize') return preflight()

  if (m === 'GET' && (pathname === '/.well-known/oauth-protected-resource' || pathname === '/.well-known/oauth-protected-resource/mcp')) {
    return json(protectedResourceMetadata(appUrl()), 200, { 'cache-control': 'public, max-age=3600' })
  }
  if (m === 'GET' && (pathname === '/.well-known/oauth-authorization-server' || pathname === '/.well-known/oauth-authorization-server/mcp')) {
    return json(authorizationServerMetadata(appUrl()), 200, { 'cache-control': 'public, max-age=3600' })
  }
  if (pathname === '/oauth/register' && m === 'POST') return register(request)
  if (pathname === '/oauth/authorize' && m === 'GET') return authorizeGet(request)
  if (pathname === '/oauth/authorize' && m === 'POST') return authorizePost(request)
  if (pathname === '/oauth/token' && m === 'POST') return token(request)
  if (pathname === '/oauth/revoke' && m === 'POST') return revoke(request)
  return null
}

export interface McpConnection {
  id: string
  clientName: string
  clientId: string
  scopes: string[]
  createdAt: number
  lastUsedAt: number | null
}

export async function listMcpConnections(userId: string): Promise<McpConnection[]> {
  const rows = await all<{ id: string; client_id: string; scope: string; created_at: number; last_used_at: number | null; name: string | null; redirect_uris: string | null }>(
    `SELECT g.id, g.client_id, g.scope, g.created_at, g.last_used_at, c.name, c.redirect_uris
     FROM oauth_grants g LEFT JOIN oauth_clients c ON c.id = g.client_id
     WHERE g.user_id = ? ORDER BY COALESCE(g.last_used_at, g.created_at) DESC`,
    userId,
  )
  return rows.map((r) => {
    const first = parseJson<string[]>(r.redirect_uris, [])[0]
    let fallback = r.client_id
    try {
      if (first) fallback = new URL(first).host || new URL(first).protocol.replace(/:$/, '')
    } catch {
      /* keep client id */
    }
    return { id: r.id, clientName: r.name ?? fallback, clientId: r.client_id, scopes: r.scope.split(' '), createdAt: r.created_at, lastUsedAt: r.last_used_at }
  })
}

export async function revokeMcpConnection(userId: string, grantId: string): Promise<void> {
  await run('DELETE FROM oauth_grants WHERE id = ? AND user_id = ?', grantId, userId)
}

/** Cron: drop expired tokens, codes, pending requests, idle grants and never-used registrations. */
export async function cleanupOAuth(): Promise<void> {
  const t = now()
  await run('DELETE FROM oauth_tokens WHERE expires_at < ?', t)
  await run('DELETE FROM oauth_codes WHERE expires_at < ?', t)
  await run('DELETE FROM oauth_requests WHERE expires_at < ?', t)
  await run(`DELETE FROM oauth_grants WHERE NOT EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.grant_id = oauth_grants.id) AND created_at < ?`, t - 60 * 60_000)
  await run(
    `DELETE FROM oauth_clients WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = oauth_clients.id)`,
    t - 30 * 24 * 60 * 60_000,
  )
}
