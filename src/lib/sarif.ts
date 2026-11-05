// Pure SARIF 2.1.0 exporter for openscan security scan results.
// No I/O, no dependencies: give it a scan and its findings, get back a SarifLog.

export interface SarifScanInput {
  id: string
  repo: string // owner/name
  html_url: string | null
  commit_sha: string | null
  status: string
  created_at: number
  finished_at: number | null
  engine: string | null
  model: string | null
  summary?: { riskLevel?: string; headline?: string } | null
}

export interface SarifFindingInput {
  id: string
  severity: string // critical|high|medium|low|info
  category: string // code|dependency|secret|config|ci
  title: string
  file: string | null
  line: number | null
  description: string
  impact: string | null
  recommendation: string | null
  confidence: string | null
  priority: number | null
  status: string // open|dismissed|fixed
  verdict: string | null // confirmed|rejected|needs_validation|unverified|null
  verification: string | null
  threat_model: string | null
  source: string | null
  fingerprint: string
}

// ---- Minimal SARIF 2.1.0 types (only what we emit) ----

export type SarifLevel = 'error' | 'warning' | 'note' | 'none'

export interface SarifMessage {
  text: string
}

export interface SarifReportingDescriptor {
  id: string
  name?: string
  shortDescription?: SarifMessage
  fullDescription?: SarifMessage
  help?: SarifMessage
  defaultConfiguration?: { level: SarifLevel }
  properties?: Record<string, unknown>
}

export interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string }
    region?: { startLine: number }
  }
}

export interface SarifSuppression {
  kind: 'inSource' | 'external'
  status?: 'accepted' | 'underReview' | 'rejected'
  justification?: string
}

export interface SarifResult {
  ruleId: string
  ruleIndex: number
  level: SarifLevel
  message: SarifMessage
  locations?: SarifLocation[]
  partialFingerprints: Record<string, string>
  suppressions?: SarifSuppression[]
  properties?: Record<string, unknown>
}

export interface SarifInvocation {
  executionSuccessful: boolean
  startTimeUtc?: string
  endTimeUtc?: string
}

export interface SarifRun {
  tool: {
    driver: {
      name: string
      version: string
      informationUri?: string
      rules: SarifReportingDescriptor[]
    }
  }
  automationDetails: { id: string }
  versionControlProvenance: Array<{ repositoryUri: string; revisionId?: string }>
  invocations: SarifInvocation[]
  results: SarifResult[]
  properties?: Record<string, unknown>
}

export interface SarifLog {
  $schema: string
  version: '2.1.0'
  runs: SarifRun[]
}

// ---- Mappings ----

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
type Severity = (typeof SEVERITIES)[number]

function normSeverity(s: string): Severity {
  const v = (s ?? '').toLowerCase().trim()
  return (SEVERITIES as readonly string[]).includes(v) ? (v as Severity) : 'medium'
}

const SECURITY_SEVERITY: Record<Severity, string> = {
  critical: '9.5',
  high: '8.0',
  medium: '5.5',
  low: '3.0',
  info: '0.0',
}

const LEVEL: Record<Severity, SarifLevel> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'note',
  info: 'note',
}

function severityRank(s: string): number {
  const v = (s ?? '').toLowerCase().trim()
  const i = (SEVERITIES as readonly string[]).indexOf(v)
  return i === -1 ? SEVERITIES.length : i
}

function precisionFor(f: SarifFindingInput): string {
  if (f.verdict === 'confirmed') return 'very-high'
  const c = (f.confidence ?? '').toLowerCase().trim()
  return c === 'high' || c === 'medium' || c === 'low' ? c : 'medium'
}

const MAX_FULL_DESCRIPTION = 1000

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return (space > max * 0.8 ? cut.slice(0, space) : cut).trimEnd() + '…'
}

function slug(s: string, max = 64): string {
  const out = (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return out || 'finding'
}

function ruleName(title: string): string {
  const name = (title ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join('')
  return name || 'Finding'
}

export function ruleIdFor(f: Pick<SarifFindingInput, 'category' | 'title'>): string {
  return `openscan/${slug(f.category, 32)}/${slug(f.title)}`
}

function artifactUri(file: string): string {
  const cleaned = file.replace(/\\/g, '/').replace(/^(?:\.\/|\/)+/, '')
  return cleaned
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined) out[k] = v
  return out as Partial<T>
}

/** DB timestamps are epoch ms; tolerate epoch seconds too. */
function iso(t: number | null | undefined): string | undefined {
  if (typeof t !== 'number' || !Number.isFinite(t)) return undefined
  const ms = t < 1e11 ? t * 1000 : t
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function suppressionsFor(f: SarifFindingInput): SarifSuppression[] | undefined {
  if (f.status === 'dismissed') {
    return [{ kind: 'external', status: 'accepted', justification: f.verification || 'Dismissed in openscan' }]
  }
  if (f.status === 'fixed') {
    return [{ kind: 'external', status: 'accepted', justification: 'Marked fixed in openscan' }]
  }
  if (f.verdict === 'rejected') {
    return [
      { kind: 'external', status: 'accepted', justification: f.verification || 'Rejected by the independent validator' },
    ]
  }
  return undefined
}

function compareFindings(a: SarifFindingInput, b: SarifFindingInput): number {
  const ao = a.status === 'open' ? 0 : 1
  const bo = b.status === 'open' ? 0 : 1
  if (ao !== bo) return ao - bo
  const sr = severityRank(a.severity) - severityRank(b.severity)
  if (sr !== 0) return sr
  const ap = a.priority ?? Number.POSITIVE_INFINITY
  const bp = b.priority ?? Number.POSITIVE_INFINITY
  if (ap !== bp) return ap < bp ? -1 : 1
  // Final tie-break keeps output independent of input order.
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}

function messageFor(f: SarifFindingInput): string {
  let text = f.title
  if (f.description) text += `\n\n${f.description}`
  if (f.impact) text += `\n\nImpact: ${f.impact}`
  return text
}

function ruleFor(f: SarifFindingInput, id: string): SarifReportingDescriptor {
  const sev = normSeverity(f.severity)
  const rule: SarifReportingDescriptor = {
    id,
    name: ruleName(f.title),
    shortDescription: { text: f.title },
    fullDescription: { text: truncate(f.description || f.title, MAX_FULL_DESCRIPTION) },
  }
  if (f.recommendation) rule.help = { text: f.recommendation }
  rule.defaultConfiguration = { level: LEVEL[sev] }
  rule.properties = {
    tags: ['security', f.category],
    'security-severity': SECURITY_SEVERITY[sev],
    precision: precisionFor(f),
  }
  return rule
}

export function toSarif(
  scan: SarifScanInput,
  findings: SarifFindingInput[],
  opts?: { informationUri?: string; toolVersion?: string },
): SarifLog {
  const sorted = [...findings].sort(compareFindings)
  const rules: SarifReportingDescriptor[] = []
  const ruleIndex = new Map<string, number>()
  const results: SarifResult[] = []

  for (const f of sorted) {
    const id = ruleIdFor(f)
    let idx = ruleIndex.get(id)
    if (idx === undefined) {
      idx = rules.length
      ruleIndex.set(id, idx)
      rules.push(ruleFor(f, id))
    }

    const result: SarifResult = {
      ruleId: id,
      ruleIndex: idx,
      level: LEVEL[normSeverity(f.severity)],
      message: { text: messageFor(f) },
      partialFingerprints: { 'openscanFingerprint/v1': f.fingerprint },
    }

    const uri = f.file ? artifactUri(f.file) : ''
    if (uri) {
      const loc: SarifLocation = { physicalLocation: { artifactLocation: { uri } } }
      if (typeof f.line === 'number' && Number.isInteger(f.line) && f.line >= 1) {
        loc.physicalLocation.region = { startLine: f.line }
      }
      result.locations = [loc]
    }

    const suppressions = suppressionsFor(f)
    if (suppressions) result.suppressions = suppressions

    result.properties = compact({
      severity: f.severity,
      category: f.category,
      confidence: f.confidence,
      priority: f.priority,
      verdict: f.verdict,
      source: f.source,
      threatModel: f.threat_model,
      findingId: f.id,
    })

    results.push(result)
  }

  const driver: SarifRun['tool']['driver'] = {
    name: 'openscan',
    version: opts?.toolVersion ?? '0.1.0',
    ...(opts?.informationUri ? { informationUri: opts.informationUri } : {}),
    rules,
  }

  const provenance: SarifRun['versionControlProvenance'][number] = {
    repositoryUri: scan.html_url ?? `https://github.com/${scan.repo}`,
  }
  if (scan.commit_sha && /^[0-9a-f]{40}$/i.test(scan.commit_sha)) provenance.revisionId = scan.commit_sha

  const invocation: SarifInvocation = { executionSuccessful: scan.status === 'completed' }
  const start = iso(scan.created_at)
  if (start) invocation.startTimeUtc = start
  const end = iso(scan.finished_at)
  if (end) invocation.endTimeUtc = end

  const run: SarifRun = {
    tool: { driver },
    automationDetails: { id: `openscan/${scan.id}` },
    versionControlProvenance: [provenance],
    invocations: [invocation],
    results,
  }
  const props = compact({
    repository: scan.repo,
    engine: scan.engine,
    model: scan.model,
    riskLevel: scan.summary?.riskLevel,
    headline: scan.summary?.headline,
  })
  if (Object.keys(props).length) run.properties = props

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [run],
  }
}

export function sarifFilename(scan: { id: string; repo: string }): string {
  const repo = (scan.repo ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
    .replace(/[-.]+$/g, '')
  const id = (scan.id ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
  return ['openscan', repo || 'repo', id || 'scan'].join('-') + '.sarif'
}
