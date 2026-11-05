-- Scan lifecycle hardening.
--
-- 1. At most ONE active (queued/running) scan per user, repository and kind, enforced by the
--    database. The app already checked before inserting, but two concurrent requests could both
--    pass that check; with this partial unique index the second INSERT fails and the caller gets
--    the scan that won (see createScanOnce in src/lib/scanner/engine.ts).
-- 2. 'cancelled' is a new terminal status (scans.status is free text; nothing to alter).


-- Close duplicates that may predate the constraint: keep the newest active scan, fail the rest.
UPDATE scans
SET status = 'failed',
    error = 'Superseded by a newer scan of the same repository',
    finished_at = updated_at
WHERE status IN ('queued', 'running')
  AND EXISTS (
    SELECT 1 FROM scans newer
    WHERE newer.user_id = scans.user_id
      AND newer.repo_id = scans.repo_id
      AND newer.kind = scans.kind
      AND newer.status IN ('queued', 'running')
      AND (newer.created_at > scans.created_at OR (newer.created_at = scans.created_at AND newer.id > scans.id))
  );

CREATE UNIQUE INDEX scans_one_active ON scans(user_id, repo_id, kind) WHERE status IN ('queued', 'running');

