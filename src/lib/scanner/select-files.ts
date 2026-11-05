/**
 * Picks which files an agent should read, in order. Pure function (unit-tested).
 * We can't send a whole repo to an LLM, so we rank by security relevance and
 * stay inside a byte budget.
 */
import type { TreeEntry } from '../github/repos'

const SKIP_DIRS = /(^|\/)(node_modules|vendor|dist|build|out|\.next|\.nuxt|coverage|__snapshots__|\.git|target|bin|obj|\.venv|venv|site-packages|third_party|fixtures?|testdata|examples?)\//i
const SKIP_EXT = /\.(png|jpe?g|gif|svg|ico|webp|avif|mp4|mp3|woff2?|ttf|eot|otf|pdf|zip|gz|tgz|jar|war|class|so|dylib|dll|exe|bin|lock|map|min\.js|min\.css|snap|csv|parquet|wasm)$/i
const LOCKFILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/

export const MANIFEST_RE = /(^|\/)(package\.json|requirements(-[\w]+)?\.txt|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?)$/
/** Lockfiles we can parse for exact dependency versions (OSV lookups). */
export const LOCK_RE = /(^|\/)(package-lock\.json|Cargo\.lock|Gemfile\.lock|go\.sum|poetry\.lock)$/

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|php|java|kt|cs|rs|scala|swift|ex|exs|sql|sh)$/i
const CONFIG_RE = /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|\.env\.example|wrangler\.(toml|jsonc?)|serverless\.ya?ml|vercel\.json|netlify\.toml|nginx\.conf|[^/]+\.tf|app\.ya?ml|settings\.py|config\.(js|ts|py|ya?ml|json))$/i
const CI_RE = /^\.github\/workflows\/[^/]+\.ya?ml$|(^|\/)(\.gitlab-ci\.yml|Jenkinsfile|\.circleci\/config\.yml)$/
const SENSITIVE_RE = /(auth|login|session|token|jwt|oauth|passw|crypt|secret|key|permission|role|admin|acl|middleware|guard|policy|upload|payment|billing|webhook|api|route|controller|handler|server|db|database|query|sql|model|exec|shell|eval|template|render|serializ|deserializ)/i
const TEST_RE = /(^|\/)(__tests__|tests?|spec|e2e|cypress|playwright)\/|\.(test|spec)\.[a-z]+$/i

export interface SelectOptions {
  maxFiles: number
  maxBytesPerFile: number
  /** Extra path substrings to boost (e.g. from the AI-built repo profile). */
  boost?: string[]
  focus?: Array<'code' | 'dependencies' | 'secrets' | 'config' | 'ci'>
}

export function scorePath(path: string, size: number, opts: SelectOptions): number {
  if (SKIP_DIRS.test(path) || SKIP_EXT.test(path) || LOCKFILES.test(path)) return -1
  if (size > opts.maxBytesPerFile * 4) return -1
  const focus = new Set(opts.focus ?? ['code', 'dependencies', 'secrets', 'config', 'ci'])
  const depth = path.split('/').length - 1
  let score = 0
  if (/(^|\/)README(\.md)?$/i.test(path) && depth === 0) score += 60
  if (MANIFEST_RE.test(path)) score += focus.has('dependencies') ? 70 : 40
  if (CI_RE.test(path)) score += focus.has('ci') ? 55 : 15
  if (CONFIG_RE.test(path)) score += focus.has('config') || focus.has('secrets') ? 50 : 20
  if (CODE_EXT.test(path)) {
    score += 20
    if (SENSITIVE_RE.test(path)) score += focus.has('code') ? 35 : 15
    if (/(^|\/)(index|main|app|server)\.[a-z]+$/i.test(path)) score += 20
  }
  if (score === 0) return -1
  if (TEST_RE.test(path)) score -= 50
  for (const b of opts.boost ?? []) if (b && path.toLowerCase().includes(b.toLowerCase())) score += 25
  score -= depth * 3
  if (size > opts.maxBytesPerFile) score -= 10
  return score
}

export function selectFiles(entries: TreeEntry[], opts: SelectOptions): string[] {
  return entries
    .map((e) => ({ path: e.path, score: scorePath(e.path, e.size ?? 0, opts) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, opts.maxFiles)
    .map((e) => e.path)
}

export function selectLockfiles(entries: TreeEntry[], max = 6): string[] {
  return entries
    .filter((e) => (LOCK_RE.test(e.path) || /(^|\/)(requirements[\w-]*\.txt|go\.mod|package\.json)$/.test(e.path)) && !SKIP_DIRS.test(e.path))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)
    .slice(0, max)
    .map((e) => e.path)
}

/** Compact directory overview for prompts (top-level dirs with file counts). */
export function treeOverview(entries: TreeEntry[], limit = 40): string {
  const counts = new Map<string, number>()
  for (const e of entries) {
    if (SKIP_DIRS.test(e.path)) continue
    const parts = e.path.split('/')
    const key = parts.length > 2 ? `${parts[0]}/${parts[1]}/` : parts.length === 2 ? `${parts[0]}/` : e.path
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, n]) => (k.endsWith('/') ? `${k} (${n} files)` : k))
    .join('\n')
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
