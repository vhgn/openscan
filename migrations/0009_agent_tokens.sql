-- Short-lived bearer tokens handed to Codex Cloud tasks so the agent can pull product
-- memory over HTTP (GET-only) instead of relying only on the inline prompt summary.
-- Only the SHA-256 of the token is stored; the token itself lives in the task prompt.
CREATE TABLE agent_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_id INTEGER NOT NULL,
  product_id TEXT,                 -- null for a settings internet probe
  scan_id TEXT,                    -- null for a settings internet probe
  purpose TEXT NOT NULL,           -- 'recon' | 'hunt' | 'validate' | 'probe'
  task_id TEXT,                    -- Codex Cloud task that received the token
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  first_used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX agent_tokens_scan ON agent_tokens(scan_id);
CREATE INDEX agent_tokens_probe ON agent_tokens(user_id, repo_id, purpose, created_at);

-- Whether this user's Codex environment for the repo can reach openscan during the agent
-- phase (internet on + our host allowlisted). Observed, not read from Codex settings:
--   'reachable' | 'unreachable' | 'checking'
ALTER TABLE user_repositories ADD COLUMN codex_net TEXT;
ALTER TABLE user_repositories ADD COLUMN codex_net_at INTEGER;
