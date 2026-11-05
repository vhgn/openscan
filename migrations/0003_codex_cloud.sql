-- Codex Cloud tasks as the agent runtime.
-- Codex environments live in the user's ChatGPT workspace, so they are per user + repo.
ALTER TABLE user_repositories ADD COLUMN codex_env_id TEXT;
ALTER TABLE user_repositories ADD COLUMN codex_env_label TEXT;
ALTER TABLE user_repositories ADD COLUMN codex_checked_at INTEGER;

-- Codex Cloud tasks started by a scan: [{ "role": "hunt", "id": "task_…", "status": "completed" }]
ALTER TABLE scans ADD COLUMN codex_tasks_json TEXT;
