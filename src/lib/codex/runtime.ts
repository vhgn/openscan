/** Wires the Codex Cloud client to openscan users, repos and AI_MODE. */
import { aiMode } from '../env'
import { first, now, run } from '../db'
import { codexCredentials } from '../chatgpt'
import { createCodexClient, pickEnvironment, type CodexClient } from './cloud'
import type { UserRow } from '../types'

/** Codex Cloud client bound to the user's ChatGPT session. */
export async function codexClientFor(user: Pick<UserRow, 'chatgpt_cookie_enc'>): Promise<CodexClient | null> {
  if (aiMode() === 'heuristic') return null
  const creds = await codexCredentials(user)
  return creds ? createCodexClient(creds) : null
}

const RECHECK_MS = 6 * 60 * 60 * 1000

/**
 * Returns the user's Codex environment for a repo, discovering it via
 * /wham/environments/by-repo when unknown or stale. Null = no environment configured.
 */
export async function codexEnvironmentFor(userId: string, repo: { id: number; full_name: string }, client: CodexClient, force = false): Promise<{ id: string; label: string | null } | null> {
  const row = await first<{ codex_env_id: string | null; codex_env_label: string | null; codex_checked_at: number | null }>(
    'SELECT codex_env_id, codex_env_label, codex_checked_at FROM user_repositories WHERE user_id = ? AND repo_id = ?',
    userId,
    repo.id,
  )
  if (!force && row?.codex_checked_at && row.codex_checked_at > now() - RECHECK_MS) {
    return row.codex_env_id ? { id: row.codex_env_id, label: row.codex_env_label } : null
  }
  const env = pickEnvironment(await client.environmentsForRepo(repo.full_name))
  await run(
    'UPDATE user_repositories SET codex_env_id = ?, codex_env_label = ?, codex_checked_at = ? WHERE user_id = ? AND repo_id = ?',
    env?.id ?? null,
    env?.label ?? null,
    now(),
    userId,
    repo.id,
  )
  return env ? { id: env.id, label: env.label } : null
}
