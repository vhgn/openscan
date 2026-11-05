/**
 * Pure OAuth 2.1 helpers for the MCP authorization server (no D1, no Worker env),
 * so they can be unit-tested with Node. See src/lib/oauth/server.ts for the endpoints.
 */

export const SCOPES = {
  'openscan:read': 'Read your repositories, scans, findings and open questions',
  'openscan:write': 'Start scans, answer questions and mark findings fixed or dismissed',
} as const
export type Scope = keyof typeof SCOPES
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[]

export const ACCESS_TOKEN_TTL_S = 60 * 60 // 1 hour
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60 // 30 days, rotated on every use
export const CODE_TTL_S = 5 * 60
export const REQUEST_TTL_S = 10 * 60

export function issuerUrls(appUrl: string) {
  const issuer = appUrl.replace(/\/+$/, '')
  return {
    issuer,
    resource: `${issuer}/mcp`,
    authorize: `${issuer}/oauth/authorize`,
    token: `${issuer}/oauth/token`,
    register: `${issuer}/oauth/register`,
    revoke: `${issuer}/oauth/revoke`,
    resourceMetadata: `${issuer}/.well-known/oauth-protected-resource/mcp`,
  }
}

/** RFC 8414 authorization server metadata. */
export function authorizationServerMetadata(appUrl: string) {
  const u = issuerUrls(appUrl)
  return {
    issuer: u.issuer,
    authorization_endpoint: u.authorize,
    token_endpoint: u.token,
    registration_endpoint: u.register,
    revocation_endpoint: u.revoke,
    scopes_supported: ALL_SCOPES,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  }
}

/** RFC 9728 protected resource metadata for the MCP endpoint. */
export function protectedResourceMetadata(appUrl: string) {
  const u = issuerUrls(appUrl)
  return {
    resource: u.resource,
    resource_name: 'openscan',
    authorization_servers: [u.issuer],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ['header'],
  }
}

/** Requested scope string → the supported subset (all scopes when none were asked for). */
export function parseScope(raw: string | null | undefined): Scope[] | null {
  const asked = (raw ?? '').split(/\s+/).filter(Boolean)
  if (!asked.length) return [...ALL_SCOPES]
  const known = ALL_SCOPES.filter((s) => asked.includes(s))
  return known.length ? known : null
}

const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost'])
const FORBIDDEN_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:'])

/**
 * Redirect URIs a client may register: https, http on loopback (native apps, RFC 8252),
 * or a private-use scheme like `cursor://` (RFC 8252 §7.1). No fragments.
 */
export function validRedirectUri(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.hash || raw.includes('#')) return false
  if (u.protocol === 'https:') return Boolean(u.hostname)
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname)
  if (FORBIDDEN_SCHEMES.has(u.protocol)) return false
  return /^[a-z][a-z0-9+.-]*:$/i.test(u.protocol)
}

/**
 * Exact string match, except that a loopback http redirect may use any port
 * (RFC 8252 §7.3: native apps pick an ephemeral port at request time).
 */
export function redirectUriMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true
  let req: URL
  try {
    req = new URL(requested)
  } catch {
    return false
  }
  if (req.protocol !== 'http:' || !LOOPBACK.has(req.hostname)) return false
  return registered.some((r) => {
    try {
      const reg = new URL(r)
      return (
        reg.protocol === 'http:' &&
        reg.hostname === req.hostname &&
        reg.pathname === req.pathname &&
        reg.search === req.search
      )
    } catch {
      return false
    }
  })
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) === challenge. */
export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  let s = ''
  for (const b of new Uint8Array(digest)) s += String.fromCharCode(b)
  const computed = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  if (computed.length !== challenge.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ challenge.charCodeAt(i)
  return diff === 0
}

/** RFC 8707 resource indicator: absent, or our MCP endpoint (trailing slash tolerated). */
export function resourceMatches(requested: string | null | undefined, expected: string): boolean {
  if (!requested) return true
  return requested.replace(/\/+$/, '') === expected.replace(/\/+$/, '')
}

/** A client_id that names a Client ID Metadata Document (draft-ietf-oauth-client-id-metadata-document). */
export function isMetadataDocumentClientId(clientId: string): boolean {
  try {
    const u = new URL(clientId)
    return u.protocol === 'https:' && u.pathname.length > 1 && !u.hash && !u.username && !u.password
  } catch {
    return false
  }
}

/** Only same-origin relative paths are safe post-login destinations. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  if (/[\r\n]/.test(next)) return null
  return next
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
