/**
 * Product areas for findings ("Auth", "Payments", …), used to filter reports.
 * Pure and deterministic: derived from a finding's category, title, description
 * and file path, so it works for every engine and for findings already stored.
 * A finding can belong to several areas.
 */

export const AREAS = [
  { id: 'auth', label: 'Auth' },
  { id: 'payments', label: 'Payments' },
  { id: 'data', label: 'Data' },
  { id: 'web', label: 'Web & API' },
  { id: 'files', label: 'Files' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'ai', label: 'AI agents' },
  { id: 'infra', label: 'Infrastructure' },
  { id: 'ci', label: 'CI/CD' },
  { id: 'dependencies', label: 'Dependencies' },
] as const

export type AreaId = (typeof AREAS)[number]['id']

const RULES: Array<[AreaId, RegExp]> = [
  ['auth', /\b(auth\w*|log ?in|log ?out|sign ?(in|up)|sessions?|jwt|oauth\d?|oidc|saml|sso|mfa|2fa|totp|passwords?|passwd|credentials?|permissions?|rbac|acl|roles?|privilege\w*|impersonat\w*|access control|idor|account takeover)\b/i],
  ['payments', /\b(payments?|stripe|paypal|braintree|adyen|billing|invoices?|checkout|subscriptions?|refunds?|charges?|credit ?cards?|pci)\b/i],
  ['data', /\b(sql\w*|nosql|database|postgres\w*|mysql|sqlite|mongo\w*|redis|prisma|drizzle|orm|quer(y|ies)|pii|personal data|gdpr|tenant\w*|data leak\w*|exfiltrat\w*)\b/i],
  ['web', /\b(xss|csrf|cors|ssrf|open redirect|redirects?|clickjacking|csp|cookies?|headers?|endpoints?|api(?! ?keys?)|graphql|webhooks?|routes?|request smuggling|prototype pollution|template injection|ssti)\b/i],
  ['files', /\b(uploads?|file ?names?|path traversal|directory traversal|zip ?slip|downloads?|s3|buckets?|blob storage|attachments?)\b/i],
  ['secrets', /\b(secrets?|api ?keys?|private keys?|hard-?coded (key|token|password|credential)s?|leaked (key|token)s?|\.env)\b/i],
  ['ai', /\b(llm|prompt injection|prompts?|agents?|agentic|mcp|openai|anthropic|claude|copilot|skills?\.md|agents\.md)\b/i],
  ['infra', /\b(docker\w*|kubernetes|k8s|helm|terraform|nginx|tls|ssl|certificates?|runtime|node\.?js \d+|end-of-life|eol|php \d|brotli|gitlab)\b/i],
  ['ci', /\b(ci|cd|ci\/cd|github actions?|workflows?|pipelines?|pull_request_target)\b/i],
]

export interface AreaInput {
  category?: string | null
  title?: string | null
  description?: string | null
  file?: string | null
  source?: string | null
}

export function areasFor(f: AreaInput): AreaId[] {
  const found = new Set<AreaId>()
  if (f.category === 'dependency' || f.source === 'osv' || f.source === 'supply-chain') found.add('dependencies')
  if (f.category === 'secret') found.add('secrets')
  if (f.category === 'ci') found.add('ci')
  if (f.category === 'config' || f.source === 'runtime-advisory') found.add('infra')
  const file = f.file ?? ''
  if (/(^|\/)\.github\/workflows\//.test(file)) found.add('ci')
  if (/(^|\/)(Dockerfile|docker-compose[^/]*|.*\.tf|helm\/|k8s\/)/i.test(file)) found.add('infra')
  // Paths count as words: "src/auth/session.ts" → "src auth session ts".
  const text = [f.title, f.description, file.replace(/[/._-]+/g, ' ')].filter(Boolean).join(' \n ')
  for (const [area, re] of RULES) if (re.test(text)) found.add(area)
  // Keep the canonical order so filters list consistently.
  return AREAS.map((a) => a.id).filter((id) => found.has(id))
}

export function areaLabel(id: string): string {
  return AREAS.find((a) => a.id === id)?.label ?? id
}
