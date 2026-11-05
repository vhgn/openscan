/**
 * Short-lived bearer tokens for Codex Cloud tasks (see memory-api.ts).
 * One token per task, scoped to one user + repo (+ product/scan), stored only as a
 * SHA-256 hash, expiring with the task timeout and revoked as soon as the task ends.
 */
import { first, now, run } from '../db'
import { randomToken, sha256Hex } from '../crypto'
import { appUrl } from '../env'
import { agentApiBase, bearerToken, type MemoryApi } from './memory-api'

export interface AgentTokenRow {
  token_hash: string
  user_id: string
  repo_id: number
  product_id: string | null
  scan_id: string | null
  purpose: string
  task_id: string | null
  expires_at: number
  revoked_at: number | null
  uses: number
  first_used_at: number | null
  created_at: number
}

/** Requests one token may make; a runaway loop should not hammer D1. */
const MAX_USES = 300

/**
 * Issues a token for a task about to be created. Returns null when openscan has no
 * public https URL (local dev): Codex could never reach it, so the prompt omits the API.
 */
export async function issueAgentToken(input: {
  userId: string
  repoId: number
  productId: string | null
  scanId: string | null
  purpose: string
  ttlMs: number
}): Promise<{ api: MemoryApi; hash: string } | null> {
  const baseUrl = agentApiBase(appUrl())
  if (!baseUrl) return null
  const token = randomToken(32)
  const hash = await sha256Hex(token)
  const expiresAt = now() + input.ttlMs
  await run(
    `INSERT INTO agent_tokens (token_hash, user_id, repo_id, product_id, scan_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    hash,
    input.userId,
    input.repoId,
    input.productId,
    input.scanId,
    input.purpose,
    expiresAt,
    now(),
  )
  return { api: { baseUrl, token, expiresAt }, hash }
}

export async function attachTask(hash: string, taskId: string) {
  await run('UPDATE agent_tokens SET task_id = ? WHERE token_hash = ?', taskId, hash)
}

/** Revokes a token (task finished) and returns how many requests it made. */
export async function revokeAgentToken(hash: string): Promise<number> {
  await run('UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?', now(), hash)
  return (await first<{ uses: number }>('SELECT uses FROM agent_tokens WHERE token_hash = ?', hash))?.uses ?? 0
}

export async function revokeScanTokens(scanId: string) {
  await run('UPDATE agent_tokens SET revoked_at = ? WHERE scan_id = ? AND revoked_at IS NULL', now(), scanId)
}

export async function setCodexNet(userId: string, repoId: number, status: 'reachable' | 'unreachable' | 'checking') {
  await run('UPDATE user_repositories SET codex_net = ?, codex_net_at = ? WHERE user_id = ? AND repo_id = ?', status, now(), userId, repoId)
}

/**
 * Authenticates an agent request and counts the use. Scan tokens additionally require
 * the scan to still be running. The first use proves the environment can reach us.
 */
export async function authenticateAgent(request: Request): Promise<AgentTokenRow | null> {
  const token = bearerToken(request.headers.get('authorization'))
  if (!token) return null
  const row = await first<AgentTokenRow>('SELECT * FROM agent_tokens WHERE token_hash = ?', await sha256Hex(token))
  if (!row || row.revoked_at || row.expires_at < now() || row.uses >= MAX_USES) return null
  if (row.scan_id) {
    const scan = await first<{ status: string }>('SELECT status FROM scans WHERE id = ?', row.scan_id)
    if (scan?.status !== 'running') return null
  }
  await run('UPDATE agent_tokens SET uses = uses + 1, first_used_at = COALESCE(first_used_at, ?) WHERE token_hash = ?', now(), row.token_hash)
  if (!row.first_used_at) {
    await setCodexNet(row.user_id, row.repo_id, 'reachable')
    if (row.scan_id) {
      await run('INSERT INTO scan_events (scan_id, ts, level, message) VALUES (?, ?, ?, ?)', row.scan_id, now(), 'info', `Codex ${row.purpose} task reached the product memory API`)
    }
  }
  return row
}
