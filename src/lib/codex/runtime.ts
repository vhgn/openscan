/** Wires the Codex Cloud client to openscan users, repos and AI_MODE. */
import { aiMode, appUrl } from '../env'
import { all, first, now, run } from '../db'
import { codexCredentials } from '../chatgpt'
import { createCodexClient, pickEnvironment, type CodexClient } from './cloud'
import type { UserRow } from '../types'
import { attachTask, issueAgentToken, revokeAgentToken, setCodexNet, type AgentTokenRow } from './agent-tokens'
import { probePrompt, settleProbe, type NetStatus } from './memory-api'

/**
 * Codex Cloud client bound to the user's ChatGPT session. With the user's id it also
 * records whether chatgpt.com let the request through (users.codex_blocked_at), so
 * Settings can say so instead of failing silently.
 */
export async function codexClientFor(user: Pick<UserRow, 'chatgpt_cookie_enc'> & { id?: string; codex_blocked_at?: number | null }): Promise<CodexClient | null> {
  if (aiMode() === 'heuristic') return null
  const creds = await codexCredentials(user)
  if (!creds) return null
  const id = user.id
  let blockedAt = user.codex_blocked_at ?? null
  return createCodexClient(creds, fetch, {
    onBlocked: async () => {
      blockedAt = now()
      if (id) await run('UPDATE users SET codex_blocked_at = ? WHERE id = ?', blockedAt, id).catch(() => undefined)
    },
    onOk: async () => {
      if (!blockedAt || !id) return
      blockedAt = null
      await run('UPDATE users SET codex_blocked_at = NULL WHERE id = ?', id).catch(() => undefined)
    },
  })
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

// ---------------------------------------------------------------- runner environment

export interface CodexRunner {
  id: string
  label: string | null
  /** Branch of the runner environment's own repository for Codex to check out. */
  branch: string
}

/** The user's runner environment: used for repos without an environment of their own. */
export function codexRunnerOf(user: Pick<UserRow, 'codex_runner_env_id' | 'codex_runner_env_label' | 'codex_runner_branch'>): CodexRunner | null {
  if (!user.codex_runner_env_id) return null
  return { id: user.codex_runner_env_id, label: user.codex_runner_env_label ?? null, branch: user.codex_runner_branch || 'main' }
}

/** Saves (or clears, with null) the runner environment after checking it exists in the user's workspace. */
export async function setCodexRunner(
  user: Pick<UserRow, 'id' | 'chatgpt_cookie_enc'>,
  input: { envId: string; branch: string } | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!input) {
    await run('UPDATE users SET codex_runner_env_id = NULL, codex_runner_env_label = NULL, codex_runner_branch = NULL, updated_at = ? WHERE id = ?', now(), user.id)
    return { ok: true }
  }
  const client = await codexClientFor(user)
  if (!client) return { ok: false, reason: 'Link ChatGPT first' }
  const env = (await client.listEnvironments()).find((e) => e.id === input.envId)
  if (!env) return { ok: false, reason: 'That environment is not in your Codex workspace' }
  await run(
    'UPDATE users SET codex_runner_env_id = ?, codex_runner_env_label = ?, codex_runner_branch = ?, updated_at = ? WHERE id = ?',
    env.id,
    env.label,
    input.branch.trim() || 'main',
    now(),
    user.id,
  )
  return { ok: true }
}

// ---------------------------------------------------------------- internet probe (settings)

const PROBE_TTL_MS = 15 * 60_000

/** The host the owner must allowlist in the Codex environment's internet settings. */
export function openscanHost(): string {
  try {
    return new URL(appUrl()).host
  } catch {
    return ''
  }
}

/**
 * Codex does not expose an environment's internet setting through any API we can rely on,
 * so we observe it: a tiny Ask-mode task curls /api/agent/ping with a 15-minute token.
 */
export async function startInternetProbe(user: Pick<UserRow, 'id' | 'chatgpt_cookie_enc'>, repo: { id: number; full_name: string; default_branch: string | null }): Promise<{ ok: true; taskId: string } | { ok: false; reason: string }> {
  const client = await codexClientFor(user)
  if (!client) return { ok: false, reason: 'Link ChatGPT first' }
  const env = await codexEnvironmentFor(user.id, repo, client)
  if (!env) return { ok: false, reason: `No Codex environment for ${repo.full_name}` }
  const issued = await issueAgentToken({ userId: user.id, repoId: repo.id, productId: null, scanId: null, purpose: 'probe', ttlMs: PROBE_TTL_MS })
  if (!issued) return { ok: false, reason: 'openscan has no public https URL (APP_URL), so Codex could never reach it' }
  try {
    const taskId = await client.createTask({ environmentId: env.id, branch: repo.default_branch || 'main', prompt: probePrompt(issued.api), qaMode: true })
    await attachTask(issued.hash, taskId)
    await setCodexNet(user.id, repo.id, 'checking')
    return { ok: true, taskId }
  } catch (e) {
    await revokeAgentToken(issued.hash)
    return { ok: false, reason: `Could not start the Codex task: ${String(e).slice(0, 160)}` }
  }
}

/** Settles probes still marked 'checking' (called while the settings page polls). */
export async function settleInternetProbes(user: Pick<UserRow, 'id' | 'chatgpt_cookie_enc'>): Promise<Record<number, NetStatus>> {
  const pending = await all<{ repo_id: number }>(`SELECT repo_id FROM user_repositories WHERE user_id = ? AND codex_net = 'checking'`, user.id)
  if (!pending.length) return {}
  const client = await codexClientFor(user).catch(() => null)
  const out: Record<number, NetStatus> = {}
  for (const { repo_id } of pending) {
    const tok = await first<AgentTokenRow>(
      `SELECT * FROM agent_tokens WHERE user_id = ? AND repo_id = ? AND purpose = 'probe' ORDER BY created_at DESC LIMIT 1`,
      user.id,
      repo_id,
    )
    if (!tok) {
      await run(`UPDATE user_repositories SET codex_net = NULL WHERE user_id = ? AND repo_id = ?`, user.id, repo_id)
      continue
    }
    const task = tok.uses === 0 && tok.task_id && client ? await client.getTask(tok.task_id).catch(() => null) : null
    const status = settleProbe({ uses: tok.uses, taskStatus: task?.status ?? null, createdAt: tok.created_at, now: now() })
    if (status !== 'checking') {
      await revokeAgentToken(tok.token_hash)
      // A hit already marked the repo reachable; only record the negative outcome here.
      if (status === 'unreachable') await setCodexNet(user.id, repo_id, 'unreachable')
    }
    out[repo_id] = status
  }
  return out
}
