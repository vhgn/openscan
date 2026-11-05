-- chatgpt.com's bot protection can refuse Codex Cloud requests from openscan's server
-- (an HTML 403 before the request reaches the API). Remember when that last happened so
-- Settings and scan logs can say so; any successful Codex request clears it.
ALTER TABLE users ADD COLUMN codex_blocked_at INTEGER;
