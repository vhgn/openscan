/**
 * Deterministic fallback analyzer. Used when the user hasn't linked ChatGPT
 * (or AI_MODE=heuristic). Also gives the AI a cheap first pass to build on.
 */
import type { FindingDraft, RepoProfile } from '../types'

interface Rule {
  id: string
  test: RegExp
  files?: RegExp
  finding: Omit<FindingDraft, 'file' | 'line'>
}

const RULES: Rule[] = [
  {
    id: 'aws-key',
    test: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
    finding: { severity: 'critical', category: 'secret', title: 'AWS access key committed to the repository', description: 'A string matching an AWS access key id is present in source.', impact: 'Anyone with read access to the repo (or its history) can use the key until it is revoked.', recommendation: 'Revoke the key in AWS IAM now, then remove it from history and load it from a secret manager.', confidence: 'high' },
  },
  {
    id: 'private-key',
    test: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    finding: { severity: 'critical', category: 'secret', title: 'Private key committed to the repository', description: 'A PEM private key block is present in source.', impact: 'Compromise of whatever this key protects (TLS, SSH, signing).', recommendation: 'Rotate the key, purge it from git history, and store it as a secret.', confidence: 'high' },
  },
  {
    id: 'generic-secret',
    test: /\b(api[_-]?key|secret|passw(or)?d|token)\b\s*[:=]\s*['"][A-Za-z0-9_\-\/+=]{16,}['"]/i,
    files: /\.(ts|tsx|js|jsx|py|go|rb|php|java|cs|ya?ml|json|env)$/i,
    finding: { severity: 'high', category: 'secret', title: 'Hard-coded credential-like value', description: 'A variable named like a secret is assigned a long literal value.', impact: 'Credentials in source leak through forks, logs and CI artifacts.', recommendation: 'Move the value to environment/secret storage and rotate it.', confidence: 'medium' },
  },
  {
    id: 'eval',
    test: /\b(eval|new Function)\s*\(/,
    files: /\.(js|jsx|ts|tsx|mjs|cjs)$/,
    finding: { severity: 'medium', category: 'code', title: 'Dynamic code evaluation', description: '`eval` / `new Function` executes strings as code.', impact: 'If any part of the string is attacker-influenced this becomes remote code execution.', recommendation: 'Replace with a parser or explicit dispatch table.', confidence: 'medium' },
  },
  {
    id: 'shell-exec',
    test: /(child_process\.)?(exec|execSync)\s*\(\s*[`'"].*\$\{|subprocess\.(call|run|Popen)\([^)]*shell\s*=\s*True|os\.system\(/,
    finding: { severity: 'high', category: 'code', title: 'Shell command built from dynamic input', description: 'A shell command is executed with interpolated values or shell=True.', impact: 'Command injection if any interpolated value is user-controlled.', recommendation: 'Use execFile/spawn with an argument array (or subprocess without shell=True) and validate inputs.', confidence: 'medium' },
  },
  {
    id: 'sql-concat',
    test: /(SELECT|INSERT|UPDATE|DELETE)\s[^;]*['"`]\s*\+\s*\w|(query|execute|raw)\(\s*[`f]['"]?[^)]*(\$\{|\{)\w/i,
    files: /\.(js|jsx|ts|tsx|py|go|rb|php|java|cs)$/i,
    finding: { severity: 'high', category: 'code', title: 'SQL built with string concatenation/interpolation', description: 'A SQL statement appears to be assembled from variables instead of bound parameters.', impact: 'SQL injection can expose or modify the whole database.', recommendation: 'Use parameterized queries / the ORM query builder.', confidence: 'low' },
  },
  {
    id: 'tls-off',
    test: /verify\s*=\s*False|rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/,
    finding: { severity: 'medium', category: 'code', title: 'TLS certificate verification disabled', description: 'Outbound TLS verification is turned off.', impact: 'Traffic can be intercepted/modified by anyone on the network path.', recommendation: 'Remove the override; trust a custom CA instead if needed.', confidence: 'high' },
  },
  {
    id: 'weak-hash',
    test: /createHash\(\s*['"](md5|sha1)['"]\)|hashlib\.(md5|sha1)\(/,
    finding: { severity: 'low', category: 'code', title: 'Weak hash algorithm (MD5/SHA-1)', description: 'MD5/SHA-1 are broken for security purposes.', impact: 'Unsafe if used for passwords, signatures or integrity checks.', recommendation: 'Use SHA-256+ (or bcrypt/argon2 for passwords).', confidence: 'medium' },
  },
  {
    id: 'cors-any',
    test: /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]|cors\(\s*\{\s*origin\s*:\s*(true|['"]\*['"])/,
    finding: { severity: 'medium', category: 'config', title: 'CORS allows any origin', description: 'The API answers cross-origin requests from any site.', impact: 'Combined with credentials or sensitive GETs this exposes user data to malicious sites.', recommendation: 'Restrict origins to an allowlist.', confidence: 'medium' },
  },
  {
    id: 'xss-sink',
    test: /dangerouslySetInnerHTML|\.innerHTML\s*=|v-html=|\|\s*safe\b|mark_safe\(/,
    finding: { severity: 'medium', category: 'code', title: 'Raw HTML rendering sink', description: 'HTML is injected without framework escaping.', impact: 'Stored/reflected XSS if the HTML contains user input.', recommendation: 'Sanitize with a vetted library (e.g. DOMPurify) or render as text.', confidence: 'low' },
  },
  {
    id: 'gha-prt',
    test: /pull_request_target/,
    files: /^\.github\/workflows\//,
    finding: { severity: 'high', category: 'ci', title: 'Workflow uses pull_request_target', description: 'pull_request_target runs with repository secrets in the context of untrusted PRs.', impact: 'If it checks out PR code, a fork can steal secrets or push to the repo.', recommendation: 'Use pull_request, or never check out/execute PR head code in this workflow.', confidence: 'medium' },
  },
  {
    id: 'gha-unpinned',
    test: /uses:\s*[\w\-]+\/[\w\-]+@(main|master|v\d+)\s*$/m,
    files: /^\.github\/workflows\//,
    finding: { severity: 'low', category: 'ci', title: 'Third-party GitHub Action not pinned to a commit SHA', description: 'Actions referenced by tag/branch can change underneath you.', impact: 'A compromised action version runs with your workflow token and secrets.', recommendation: 'Pin actions to full commit SHAs (Dependabot can keep them updated).', confidence: 'high' },
  },
  {
    id: 'docker-root',
    test: /^FROM\s+\S+:latest\b/m,
    files: /Dockerfile/,
    finding: { severity: 'low', category: 'config', title: 'Container base image uses :latest', description: 'Unpinned base images make builds non-reproducible.', impact: 'Silent upgrades can introduce vulnerable or broken layers.', recommendation: 'Pin to a specific version or digest.', confidence: 'high' },
  },
]

export function heuristicFindings(path: string, content: string): FindingDraft[] {
  const out: FindingDraft[] = []
  const lines = content.split('\n')
  for (const rule of RULES) {
    if (rule.files && !rule.files.test(path)) continue
    const idx = lines.findIndex((l) => rule.test.test(l))
    if (idx === -1 && !rule.test.test(content)) continue
    out.push({ ...rule.finding, file: path, line: idx >= 0 ? idx + 1 : null })
  }
  return out
}

/** Builds a rough repo profile from file names + manifests. */
export function heuristicProfile(paths: string[], files: Record<string, string>, readme?: string): RepoProfile {
  const has = (re: RegExp) => paths.some((p) => re.test(p))
  const pkgText = Object.entries(files)
    .filter(([p]) => p.endsWith('package.json'))
    .map(([, c]) => c)
    .join('\n')
  const stack: string[] = []
  if (has(/package\.json$/)) stack.push('Node.js')
  if (has(/\.tsx?$/)) stack.push('TypeScript')
  if (/"react"/.test(pkgText)) stack.push('React')
  if (/"next"/.test(pkgText)) stack.push('Next.js')
  if (/"express"/.test(pkgText)) stack.push('Express')
  if (has(/\.py$/)) stack.push('Python')
  if (has(/go\.mod$/)) stack.push('Go')
  if (has(/Cargo\.toml$/)) stack.push('Rust')
  if (has(/Gemfile$/)) stack.push('Ruby')
  if (has(/Dockerfile/)) stack.push('Docker')
  const dataStores = [
    /pg|postgres/i.test(pkgText) && 'PostgreSQL',
    /mysql/i.test(pkgText) && 'MySQL',
    /mongo/i.test(pkgText) && 'MongoDB',
    /redis/i.test(pkgText) && 'Redis',
    /sqlite|d1/i.test(pkgText) && 'SQLite/D1',
  ].filter(Boolean) as string[]
  const sensitive = paths.filter((p) => /(auth|login|session|token|admin|payment|upload|webhook)/i.test(p)).slice(0, 8)
  return {
    summary: (readme ?? '').replace(/[#>*`]/g, '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' ').slice(0, 400) || 'No README summary available.',
    stack,
    entryPoints: paths.filter((p) => /(^|\/)(index|main|app|server)\.[a-z]+$/.test(p)).slice(0, 6),
    dataStores,
    auth: sensitive.some((p) => /auth|login|session/i.test(p)) ? `Auth-related code in ${sensitive.filter((p) => /auth|login|session/i.test(p)).slice(0, 3).join(', ')}` : 'Unknown',
    externalServices: [],
    deployment: has(/Dockerfile/) ? 'Container (Dockerfile present)' : has(/wrangler\./) ? 'Cloudflare Workers' : has(/vercel\.json/) ? 'Vercel' : 'Unknown',
    sensitiveAreas: sensitive,
    notes: ['Profile generated heuristically (no AI session linked).'],
  }
}

/** Standard questions every repo raises; some can be answered from the tree. */
export function heuristicQuestions(paths: string[]): Array<{ question: string; rationale: string; answer?: string; evidence?: string }> {
  const qs: Array<{ question: string; rationale: string; answer?: string; evidence?: string }> = []
  const dockerfile = paths.find((p) => /Dockerfile/.test(p))
  qs.push({
    question: 'Is this application reachable from the public internet?',
    rationale: 'Internet exposure changes the severity of most findings.',
    ...(dockerfile ? { answer: 'Likely deployed as a service (Dockerfile present); exposure still unconfirmed.', evidence: dockerfile } : {}),
  })
  qs.push({ question: 'What kind of data does it store or process (PII, payments, health, credentials)?', rationale: 'Data sensitivity drives impact ratings.' })
  const auth = paths.find((p) => /(auth|login|session)/i.test(p))
  qs.push({
    question: 'How are users authenticated, and is there an admin role?',
    rationale: 'Authorization bugs are only meaningful relative to the intended access model.',
    ...(auth ? { answer: `Authentication code exists (e.g. ${auth}); role model not determined.`, evidence: auth } : {}),
  })
  return qs
}
