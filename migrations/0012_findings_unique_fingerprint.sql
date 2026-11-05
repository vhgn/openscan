-- One row per finding per scan, enforced by the database.
--
-- saveFindings and carryFindings skip fingerprints already stored for the scan, but that is a
-- read-then-insert: a step re-run after a crash (or any other overlap) could pass the check and
-- insert the same finding twice. With this index the insert itself is the check
-- (INSERT … ON CONFLICT (scan_id, fingerprint) DO NOTHING). The same fingerprint in another scan
-- is a separate finding, so the key includes scan_id.

-- Drop duplicates that predate the index, keeping the oldest row of each. Nothing has a foreign
-- key to findings, and the validator skips queued ids that no longer exist.
DELETE FROM findings
WHERE rowid NOT IN (SELECT MIN(rowid) FROM findings GROUP BY scan_id, fingerprint);

CREATE UNIQUE INDEX findings_scan_fingerprint ON findings(scan_id, fingerprint);
