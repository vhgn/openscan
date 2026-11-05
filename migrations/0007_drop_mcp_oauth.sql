-- The MCP server and its OAuth 2.1 authorization server were removed.
-- Drop their tables where 0005_mcp_oauth.sql had created them.
DROP TABLE IF EXISTS oauth_tokens;
DROP TABLE IF EXISTS oauth_grants;
DROP TABLE IF EXISTS oauth_codes;
DROP TABLE IF EXISTS oauth_requests;
DROP TABLE IF EXISTS oauth_clients;
