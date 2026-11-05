/**
 * Step lease: at most one worker runs a step of a given scan at a time.
 *
 * Duplicates happen: queue delivery is at-least-once, and the cron re-enqueues any scan
 * that has not been updated for 10 minutes, even when its long step is still running.
 * Without a lease the same step would run twice concurrently (duplicate findings, two
 * Codex tasks, last-writer-wins on state_json).
 *
 *   acquire: conditional UPDATE, succeeds only if no live lease exists
 *   fence:   the step's writes add `AND lease_id = ?`, so a worker whose lease expired
 *            and was taken over cannot overwrite the new holder's progress
 *   release: before the next step is enqueued, so that step can take the lease
 *
 * Pure SQL over an `exec` callback (rows changed), so it is testable against SQLite.
 */
export type Exec = (sql: string, ...params: Array<string | number | null>) => Promise<number>

/**
 * A Cloudflare Queue consumer invocation gets at most 15 minutes of wall time, so a live
 * step never outlives its lease. An expired lease means the worker died; take it over.
 */
export const LEASE_MS = 15 * 60_000

/** No progress for this long → the cron re-enqueues the scan (unless a live lease says it is still running). */
export const STALL_MS = 10 * 60_000

export async function acquireLease(exec: Exec, scanId: string, leaseId: string, at: number): Promise<boolean> {
  const changed = await exec(
    `UPDATE scans SET lease_id = ?, lease_until = ?
     WHERE id = ? AND status IN ('queued','running') AND (lease_id IS NULL OR lease_until IS NULL OR lease_until < ?)`,
    leaseId,
    at + LEASE_MS,
    scanId,
    at,
  )
  return changed === 1
}

/** Releases only our own lease; a lease taken over by another worker is left alone. */
export async function releaseLease(exec: Exec, scanId: string, leaseId: string): Promise<void> {
  await exec('UPDATE scans SET lease_id = NULL, lease_until = NULL WHERE id = ? AND lease_id = ?', scanId, leaseId)
}

/** Stalled = active, no update for STALL_MS, and nobody holds a live lease. Params: (stalledBefore, at). */
export const STALLED_SCANS_SQL = `SELECT id FROM scans
  WHERE status IN ('queued','running') AND updated_at < ? AND (lease_until IS NULL OR lease_until < ?)
  LIMIT 50`
