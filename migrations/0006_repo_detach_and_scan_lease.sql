-- 1. Keep scan history when a repository leaves the GitHub App.
--
-- scans, findings, questions, user_repositories and product_repositories all reference
-- repositories(id) ON DELETE CASCADE, so deleting a repository row silently wiped the
-- user's reports. The webhook now marks the row instead (removed_at) and unlinks users;
-- re-granting the repo clears the mark (repoUpsert).
ALTER TABLE repositories ADD COLUMN removed_at INTEGER;

-- Guard: never let a DELETE cascade into scan history again.
CREATE TRIGGER repositories_keep_scan_history
BEFORE DELETE ON repositories
WHEN EXISTS (SELECT 1 FROM scans WHERE repo_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'repository has scan history: set removed_at instead of deleting');
END;

-- 2. Lease on scan steps, so one scan step never runs twice at once (a duplicate queue
-- message, or the cron reviving a scan whose long step is still running).
-- runStep takes the lease with a conditional UPDATE, fences its writes on lease_id, and
-- releases it before enqueuing the next step. An expired lease (crashed worker) can be taken over.
ALTER TABLE scans ADD COLUMN lease_id TEXT;
ALTER TABLE scans ADD COLUMN lease_until INTEGER;
