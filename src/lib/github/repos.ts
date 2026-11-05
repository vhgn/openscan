/** Repository data access used by onboarding, webhooks and the scanner. */
import { gh, GitHubError, installationToken, installUrlFor, manageInstallationUrl, userToken } from './app'
import { all, batch, first, now, run } from '../db'
import type { RepoRow, UserRow } from '../types'

export interface GhRepo {
  id: number
  full_name: string
  default_branch: string
  private: boolean
  html_url: string
  description: string | null
  language: string | null
}

export interface GhInstallation {
  id: number
  account: { login: string; type: string }
  repository_selection: string
  suspended_at: string | null
}

export async function upsertInstallation(inst: GhInstallation) {
  await run(
    `INSERT INTO installations (id, account_login, account_type, repository_selection, suspended_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET account_login = excluded.account_login, account_type = excluded.account_type,
       repository_selection = excluded.repository_selection, suspended_at = excluded.suspended_at, updated_at = excluded.updated_at`,
    inst.id,
    inst.account.login,
    inst.account.type,
    inst.repository_selection,
    inst.suspended_at ? Date.parse(inst.suspended_at) : null,
    now(),
    now(),
  )
}

export function repoUpsert(r: GhRepo, installationId: number | null): [string, Array<string | number | null>] {
  return [
    `INSERT INTO repositories (id, installation_id, full_name, default_branch, private, html_url, description, language, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET installation_id = excluded.installation_id, full_name = excluded.full_name,
       default_branch = excluded.default_branch, private = excluded.private, html_url = excluded.html_url,
       description = excluded.description, language = excluded.language, removed_at = NULL, updated_at = excluded.updated_at`,
    [r.id, installationId, r.full_name, r.default_branch, r.private ? 1 : 0, r.html_url, r.description, r.language, now(), now()],
  ]
}

/**
 * Pulls the user's installations of our app and the repositories each grants,
 * then mirrors them into D1. Called on login, on onboarding load and on "refresh".
 */
export async function syncUserRepos(user: UserRow): Promise<void> {
  const token = await userToken(user)
  if (!token) return
  const { installations } = await gh<{ installations: GhInstallation[] }>('/user/installations?per_page=100', token)
  const ops: Array<[string, Array<string | number | null>]> = []
  const seenRepoIds: number[] = []
  for (const inst of installations) {
    await upsertInstallation(inst)
    ops.push(['INSERT OR IGNORE INTO user_installations (user_id, installation_id) VALUES (?, ?)', [user.id, inst.id]])
    for (let page = 1; page <= 10; page++) {
      const res = await gh<{ repositories: GhRepo[]; total_count: number }>(
        `/user/installations/${inst.id}/repositories?per_page=100&page=${page}`,
        token,
      )
      for (const r of res.repositories) {
        seenRepoIds.push(r.id)
        ops.push(repoUpsert(r, inst.id))
        ops.push(['INSERT OR IGNORE INTO user_repositories (user_id, repo_id, selected, created_at) VALUES (?, ?, 0, ?)', [user.id, r.id, now()]])
      }
      if (res.repositories.length < 100) break
    }
  }
  // Drop installations the user no longer has access to.
  const instIds = installations.map((i) => i.id)
  ops.push([
    `DELETE FROM user_installations WHERE user_id = ? ${instIds.length ? `AND installation_id NOT IN (${instIds.map(() => '?').join(',')})` : ''}`,
    [user.id, ...instIds],
  ])
  // Unlink repos that were removed from the app's repository selection (keep public demo repos: id < 0).
  ops.push([
    `DELETE FROM user_repositories WHERE user_id = ? AND repo_id > 0 ${seenRepoIds.length ? `AND repo_id NOT IN (${seenRepoIds.map(() => '?').join(',')})` : ''}`,
    [user.id, ...seenRepoIds],
  ])
  await batch(ops)
}

export interface InstallTarget {
  id: number
  login: string
  type: 'User' | 'Organization'
  avatarUrl: string | null
  /** Set when our app is already installed on this account. */
  installationId: number | null
  installUrl: string
  manageUrl: string | null
}

/**
 * Where the user can install the app: their personal account plus every
 * organization they belong to, each marked installed or not. Organizations come
 * from GET /user/orgs with the user's token; if GitHub hides some memberships,
 * the UI also offers GitHub's own account picker.
 */
export async function listInstallTargets(user: UserRow): Promise<InstallTarget[]> {
  const token = await userToken(user)
  const orgs = token ? await gh<Array<{ id: number; login: string; avatar_url: string | null }>>('/user/orgs?per_page=100', token).catch(() => []) : []
  const installs = await all<{ id: number; account_login: string; account_type: string }>(
    `SELECT i.id, i.account_login, i.account_type FROM installations i JOIN user_installations ui ON ui.installation_id = i.id WHERE ui.user_id = ?`,
    user.id,
  )
  const accounts: Array<Pick<InstallTarget, 'id' | 'login' | 'type' | 'avatarUrl'>> = [
    { id: user.github_id, login: user.login, type: 'User', avatarUrl: user.avatar_url },
    ...orgs.map((o) => ({ id: o.id, login: o.login, type: 'Organization' as const, avatarUrl: o.avatar_url })),
  ]
  // Installations on accounts GitHub didn't list (e.g. a private org membership).
  for (const i of installs) {
    if (!accounts.some((a) => a.login.toLowerCase() === i.account_login.toLowerCase())) {
      accounts.push({ id: 0, login: i.account_login, type: i.account_type === 'Organization' ? 'Organization' : 'User', avatarUrl: null })
    }
  }
  return accounts.map((a) => {
    const inst = installs.find((i) => i.account_login.toLowerCase() === a.login.toLowerCase())
    return {
      ...a,
      installationId: inst?.id ?? null,
      installUrl: installUrlFor(a.id),
      manageUrl: inst ? manageInstallationUrl(inst.id, inst.account_type, inst.account_login) : null,
    }
  })
}

export interface UserRepoView extends RepoRow {
  selected: number
  codex_env_id: string | null
  codex_env_label: string | null
  codex_checked_at: number | null
  codex_net: 'reachable' | 'unreachable' | 'checking' | null
  codex_net_at: number | null
}

export function listUserRepos(userId: string) {
  return all<UserRepoView>(
    `SELECT r.*, ur.selected, ur.codex_env_id, ur.codex_env_label, ur.codex_checked_at, ur.codex_net, ur.codex_net_at FROM user_repositories ur JOIN repositories r ON r.id = ur.repo_id
     WHERE ur.user_id = ? ORDER BY r.full_name`,
    userId,
  )
}

export function getRepo(id: number) {
  return first<RepoRow>('SELECT * FROM repositories WHERE id = ?', id)
}

/** Token for reading repository contents: installation token, or null for public demo repos. */
export async function repoToken(repo: RepoRow): Promise<string | null> {
  return repo.installation_id ? installationToken(repo.installation_id) : null
}

export interface TreeEntry {
  path: string
  type: 'blob' | 'tree'
  size?: number
  /** Content hash: git blob sha (GitHub API) or sha256 (jsDelivr fallback). Used by product memory. */
  sha?: string
}

/**
 * No-auth tree listing for PUBLIC repos via jsDelivr's GitHub mirror. Used only for
 * demo repos when the anonymous GitHub API is rate-limited (shared egress IPs).
 */
export async function publicTree(fullName: string, branch: string): Promise<TreeEntry[] | null> {
  const res = await fetch(`https://data.jsdelivr.com/v1/packages/gh/${fullName}@${encodeURIComponent(branch)}?structure=flat`)
  if (!res.ok) return null
  const data = (await res.json()) as { files?: Array<{ name: string; size: number; hash?: string }> }
  return (data.files ?? []).map((f) => ({ path: f.name.replace(/^\//, ''), type: 'blob' as const, size: f.size, sha: f.hash }))
}

export async function fetchTree(repo: RepoRow, token: string | null): Promise<{ sha: string; entries: TreeEntry[]; truncated: boolean }> {
  try {
    return await fetchTreeApi(repo, token)
  } catch (err) {
    if (token || !(err instanceof GitHubError) || ![403, 429].includes(err.status)) throw err
    for (const branch of [repo.default_branch, 'main', 'master'].filter(Boolean) as string[]) {
      const entries = await publicTree(repo.full_name, branch)
      if (entries?.length) return { sha: branch, entries, truncated: false }
    }
    throw err
  }
}

async function fetchTreeApi(repo: RepoRow, token: string | null): Promise<{ sha: string; entries: TreeEntry[]; truncated: boolean }> {
  const [owner, name] = repo.full_name.split('/')
  let branch = repo.default_branch
  if (!branch) {
    const meta = await gh<GhRepo>(`/repos/${owner}/${name}`, token)
    branch = meta.default_branch
    await run('UPDATE repositories SET default_branch = ? WHERE id = ?', branch, repo.id)
  }
  const ref = await gh<{ object: { sha: string } }>(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(branch)}`, token)
  const tree = await gh<{ tree: TreeEntry[]; truncated: boolean }>(
    `/repos/${owner}/${name}/git/trees/${ref.object.sha}?recursive=1`,
    token,
  )
  return { sha: ref.object.sha, entries: tree.tree.filter((e) => e.type === 'blob'), truncated: tree.truncated }
}

export async function fetchFile(repo: RepoRow, token: string | null, path: string, ref: string): Promise<string> {
  const [owner, name] = repo.full_name.split('/')
  const encPath = path.split('/').map(encodeURIComponent).join('/')
  if (!token) {
    // Public demo repos: raw CDN avoids the 60 req/h anonymous API limit.
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${ref}/${encPath}`, { headers: { 'user-agent': 'openscan' } })
    if (!res.ok) throw new Error(`raw fetch ${res.status} for ${path}`)
    return res.text()
  }
  return gh<string>(`/repos/${owner}/${name}/contents/${encPath}?ref=${ref}`, token, { raw: true })
}

/** Files changed in a push range (Trail of Bits differential-review input). */
export async function fetchChangedFiles(repo: RepoRow, token: string | null, base: string, head: string): Promise<string[]> {
  const [owner, name] = repo.full_name.split('/')
  if (/^0+$/.test(base)) return [] // branch creation: no base to diff against
  const res = await gh<{ files?: Array<{ filename: string; status: string }> }>(`/repos/${owner}/${name}/compare/${base}...${head}`, token)
  return (res.files ?? []).filter((f) => f.status !== 'removed').map((f) => f.filename)
}

export interface CodeScanningAlert {
  number: number
  rule: { id: string; severity?: string | null; security_severity_level?: string | null; description?: string; name?: string }
  tool: { name: string }
  most_recent_instance: { location?: { path?: string; start_line?: number }; message?: { text?: string } }
  html_url: string
}

/**
 * Open GitHub code scanning alerts (CodeQL/Semgrep SARIF uploads) — the way openscan
 * consumes the Trail of Bits static-analysis skill inside a Worker. Requires the
 * optional "Code scanning alerts: read" app permission; returns null when unavailable.
 */
export async function fetchCodeScanningAlerts(repo: RepoRow, token: string | null): Promise<CodeScanningAlert[] | null> {
  if (!token) return null
  const [owner, name] = repo.full_name.split('/')
  try {
    return await gh<CodeScanningAlert[]>(`/repos/${owner}/${name}/code-scanning/alerts?state=open&per_page=50`, token)
  } catch (e) {
    if (e instanceof GitHubError && [403, 404].includes(e.status)) return null
    throw e
  }
}
