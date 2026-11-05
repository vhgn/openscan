import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_SCOPES,
  authorizationServerMetadata,
  escapeHtml,
  isMetadataDocumentClientId,
  parseScope,
  protectedResourceMetadata,
  redirectUriMatches,
  resourceMatches,
  safeNextPath,
  validRedirectUri,
  verifyPkce,
} from '../src/lib/oauth/core.ts'

test('discovery metadata points the MCP resource at this authorization server', () => {
  const as = authorizationServerMetadata('https://openscan.example.dev/')
  const pr = protectedResourceMetadata('https://openscan.example.dev')
  assert.equal(as.issuer, 'https://openscan.example.dev')
  assert.deepEqual(pr.authorization_servers, [as.issuer])
  assert.equal(pr.resource, 'https://openscan.example.dev/mcp')
  assert.deepEqual(as.code_challenge_methods_supported, ['S256'])
  assert.equal(as.registration_endpoint, 'https://openscan.example.dev/oauth/register')
})

test('redirect URIs: https, loopback http, private-use schemes; never script or fragments', () => {
  assert.ok(validRedirectUri('https://claude.ai/api/mcp/auth_callback'))
  assert.ok(validRedirectUri('http://localhost:6274/oauth/callback'))
  assert.ok(validRedirectUri('http://127.0.0.1:33418/callback'))
  assert.ok(validRedirectUri('cursor://anysphere.cursor-retrieval/oauth/callback'))
  assert.ok(!validRedirectUri('http://evil.example/callback'), 'plain http only on loopback')
  assert.ok(!validRedirectUri('javascript:alert(1)'))
  assert.ok(!validRedirectUri('data:text/html,hi'))
  assert.ok(!validRedirectUri('https://claude.ai/cb#frag'))
  assert.ok(!validRedirectUri('not a url'))
})

test('redirect matching is exact, except loopback ports (RFC 8252)', () => {
  const reg = ['http://127.0.0.1:3000/callback', 'https://app.example/cb']
  assert.ok(redirectUriMatches(reg, 'https://app.example/cb'))
  assert.ok(redirectUriMatches(reg, 'http://127.0.0.1:51234/callback'))
  assert.ok(!redirectUriMatches(reg, 'http://127.0.0.1:51234/other'))
  assert.ok(!redirectUriMatches(reg, 'http://localhost:3000/callback'), 'host must match too')
  assert.ok(!redirectUriMatches(reg, 'https://app.example/cb/extra'))
  assert.ok(!redirectUriMatches(reg, 'https://app.example:8443/cb'), 'only loopback ports float')
})

test('PKCE S256 verifies the RFC 7636 appendix B example and rejects others', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  assert.ok(await verifyPkce(verifier, challenge))
  assert.ok(!(await verifyPkce(verifier.replace('d', 'e'), challenge)))
  assert.ok(!(await verifyPkce('short', challenge)), 'verifier must be 43-128 chars')
})

test('scopes default to everything, ignore unknowns, reject all-unknown', () => {
  assert.deepEqual(parseScope(null), ALL_SCOPES)
  assert.deepEqual(parseScope('openscan:read offline_access'), ['openscan:read'])
  assert.equal(parseScope('admin'), null)
})

test('resource indicator must be our MCP endpoint when given', () => {
  assert.ok(resourceMatches(null, 'https://x.dev/mcp'))
  assert.ok(resourceMatches('https://x.dev/mcp/', 'https://x.dev/mcp'))
  assert.ok(!resourceMatches('https://other.dev/mcp', 'https://x.dev/mcp'))
})

test('URL client ids are metadata documents only over https with a path', () => {
  assert.ok(isMetadataDocumentClientId('https://claude.ai/oauth/claude-code-client-metadata'))
  assert.ok(!isMetadataDocumentClientId('https://example.com/'))
  assert.ok(!isMetadataDocumentClientId('http://example.com/client.json'))
  assert.ok(!isMetadataDocumentClientId('osc_abc123'))
})

test('post-login redirects stay on this origin', () => {
  assert.equal(safeNextPath('/oauth/authorize?client_id=x'), '/oauth/authorize?client_id=x')
  assert.equal(safeNextPath('//evil.example'), null)
  assert.equal(safeNextPath('/\\evil.example'), null)
  assert.equal(safeNextPath('https://evil.example'), null)
  assert.equal(safeNextPath('/x\r\nSet-Cookie: a=b'), null)
})

test('escapeHtml neutralises markup in client-supplied names', () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('1')">&`), '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;')
})
