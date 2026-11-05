-- MCP server + OAuth 2.1 authorization server (src/lib/oauth, src/lib/mcp).
-- All secrets (client secrets, codes, tokens) are stored as sha256 hashes, never in clear.

-- Registered OAuth clients: Dynamic Client Registration (RFC 7591), or a cached
-- Client ID Metadata Document when the client_id is an https URL.
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,                 -- client_id
  secret_hash TEXT,                    -- sha256(client_secret); NULL for public clients
  name TEXT,
  uri TEXT,
  redirect_uris TEXT NOT NULL,         -- JSON array
  token_endpoint_auth_method TEXT NOT NULL,  -- none | client_secret_basic | client_secret_post
  source TEXT NOT NULL DEFAULT 'dcr',  -- dcr | metadata_document
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- An authorization request waiting for the signed-in user to approve or deny it.
CREATE TABLE oauth_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  params_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Single-use authorization codes (PKCE S256 is mandatory).
CREATE TABLE oauth_codes (
  id TEXT PRIMARY KEY,                 -- sha256(code)
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- One grant per approved connection. Tokens hang off it; revoking it disconnects the client.
CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX oauth_grants_user ON oauth_grants(user_id);

CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY,                 -- sha256(token)
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                  -- access | refresh
  scope TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX oauth_tokens_grant ON oauth_tokens(grant_id);
CREATE INDEX oauth_tokens_expiry ON oauth_tokens(expires_at);
