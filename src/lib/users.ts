import { first, now, run, uid } from './db'
import type { UserRow } from './types'

export async function upsertGithubUser(gh: { id: number; login: string; name: string | null; avatar_url: string | null }): Promise<UserRow> {
  const existing = await first<UserRow>('SELECT * FROM users WHERE github_id = ?', gh.id)
  if (existing) {
    await run('UPDATE users SET login = ?, name = ?, avatar_url = ?, updated_at = ? WHERE id = ?', gh.login, gh.name, gh.avatar_url, now(), existing.id)
    return { ...existing, login: gh.login, name: gh.name, avatar_url: gh.avatar_url }
  }
  const id = uid()
  await run(
    `INSERT INTO users (id, github_id, login, name, avatar_url, onboarding_step, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'repos', ?, ?)`,
    id,
    gh.id,
    gh.login,
    gh.name,
    gh.avatar_url,
    now(),
    now(),
  )
  return (await first<UserRow>('SELECT * FROM users WHERE id = ?', id))!
}

/** Where signed-in users land: /home shows setup until onboarding is done, then the brief. */
export function landingPathFor(_user?: Pick<UserRow, 'onboarding_step'>): string {
  return '/home'
}
