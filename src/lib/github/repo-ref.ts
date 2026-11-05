/**
 * Turns what a person types for a repository into "owner/name": accepts
 * "owner/name", "github.com/owner/name", full https/ssh URLs (with .git, a
 * trailing path like /tree/main, a query or a fragment). Returns null otherwise.
 */
export function parseRepoRef(input: string): string | null {
  const s = input
    .trim()
    .replace(/^git@github\.com:/i, '')
    .replace(/^(?:(?:https?|git|ssh):\/\/)?(?:[^@/]+@)?(?:www\.)?github\.com\//i, '')
    .replace(/[?#].*$/, '')
  const [owner, rawName] = s.split('/')
  const name = (rawName ?? '').replace(/\.git$/i, '')
  // GitHub logins: alphanumerics and single hyphens, max 39. Repo names: [A-Za-z0-9._-], max 100.
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(owner ?? '')) return null
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === '.' || name === '..') return null
  return `${owner}/${name}`
}

/** A numeric repository id as typed into a "repo" argument ("123", "-456"), or null. */
export function parseRepoId(input: string): number | null {
  return /^-?\d{1,15}$/.test(input.trim()) ? Number(input.trim()) : null
}
