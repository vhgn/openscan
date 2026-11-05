-- Codex runner environment: one Codex Cloud environment the user picks to run scans of
-- repositories that have no environment of their own. Codex always checks out the
-- environment's own repository, so tasks there clone the repository under review first
-- (with a short-lived, read-only GitHub token for private repositories).
ALTER TABLE users ADD COLUMN codex_runner_env_id TEXT;
ALTER TABLE users ADD COLUMN codex_runner_env_label TEXT;
-- Branch of the runner environment's own repository that Codex checks out (not the scanned repo's).
ALTER TABLE users ADD COLUMN codex_runner_branch TEXT;
