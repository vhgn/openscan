/**
 * Repositories leaving the GitHub App (repo removed from the selection, or the app uninstalled).
 *
 * The repositories row is NOT deleted: scans, findings and questions reference it with
 * ON DELETE CASCADE, so a delete would silently wipe the user's scan history. Instead the
 * row is marked removed_at, users are unlinked (it leaves the repo picker, scheduled reports
 * and push triggers), and in-flight scans fail on their next step. Re-granting the repo
 * clears removed_at (repoUpsert).
 */
type Op = [string, Array<string | number | null>]

export function detachReposOps(repoIds: number[], at: number): Op[] {
  return repoIds.flatMap((id): Op[] => [
    ['DELETE FROM user_repositories WHERE repo_id = ?', [id]],
    ['UPDATE repositories SET removed_at = ?, updated_at = ? WHERE id = ? AND removed_at IS NULL', [at, at, id]],
  ])
}

export function detachInstallationOps(installationId: number, at: number): Op[] {
  return [
    ['DELETE FROM user_repositories WHERE repo_id IN (SELECT id FROM repositories WHERE installation_id = ?)', [installationId]],
    ['UPDATE repositories SET removed_at = ?, updated_at = ? WHERE installation_id = ? AND removed_at IS NULL', [at, at, installationId]],
    ['DELETE FROM installations WHERE id = ?', [installationId]],
  ]
}
