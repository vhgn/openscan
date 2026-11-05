/** Read models shared by server functions and the REST API. */
import { all, first, parseJson } from './db'
import type { RepoProfile, ScanRow, ScanSummary } from './types'
import { areasFor, type AreaId } from './scanner/areas'

export interface ScanListItem {
  id: string
  repo: string
  repo_id: number
  product_scan_id: string | null
  kind: string
  trigger: string
  status: string
  phase: string
  progress: number
  engine: string | null
  created_at: number
  finished_at: number | null
  risk: string | null
  headline: string | null
  findings: number
}

export async function listScans(userId: string, limit = 25): Promise<ScanListItem[]> {
  const rows = await all<ScanRow & { repo: string; findings: number }>(
    `SELECT s.*, r.full_name AS repo,
       (SELECT COUNT(*) FROM findings f WHERE f.scan_id = s.id AND f.status = 'open') AS findings
     FROM scans s JOIN repositories r ON r.id = s.repo_id
     WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT ?`,
    userId,
    limit,
  )
  return rows.map((s) => toListItem(s))
}

function toListItem(s: ScanRow & { repo: string; findings: number }): ScanListItem {
  const summary = parseJson<{ riskLevel?: string; headline?: string }>(s.summary_json, {})
  return {
    id: s.id,
    repo: s.repo,
    repo_id: s.repo_id,
    product_scan_id: s.product_scan_id ?? null,
    kind: s.kind,
    trigger: s.trigger,
    status: s.status,
    phase: s.phase,
    progress: s.progress,
    engine: s.engine,
    created_at: s.created_at,
    finished_at: s.finished_at,
    risk: summary.riskLevel ?? null,
    headline: summary.headline ?? null,
    findings: s.findings,
  }
}

const RISK_ORDER = ['critical', 'high', 'medium', 'low', 'none']

export interface ProductScanItem {
  id: string
  product_id: string
  product: string
  trigger: string
  /** Derived from the repository scans it owns. */
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  created_at: number
  finished_at: number | null
  /** Worst risk across its repository scans. */
  risk: string | null
  findings: number
  push: { repo: string | null; commit_sha: string | null } | null
  scans: ScanListItem[]
}

/** Product scans (newest first), each with the repository scans it owns. */
export async function listProductScans(userId: string, opts: { productId?: string; limit?: number } = {}): Promise<ProductScanItem[]> {
  const rows = await all<{ id: string; product_id: string; product: string; trigger: string; push_repo: string | null; commit_sha: string | null; created_at: number }>(
    `SELECT ps.id, ps.product_id, p.name AS product, ps.trigger, r.full_name AS push_repo, ps.commit_sha, ps.created_at
     FROM product_scans ps JOIN products p ON p.id = ps.product_id LEFT JOIN repositories r ON r.id = ps.push_repo_id
     WHERE ps.user_id = ? ${opts.productId ? 'AND ps.product_id = ?' : ''}
     ORDER BY ps.created_at DESC LIMIT ?`,
    ...([userId, ...(opts.productId ? [opts.productId] : []), opts.limit ?? 25] as Array<string | number>),
  )
  if (!rows.length) return []
  const children = await all<ScanRow & { repo: string; findings: number }>(
    `SELECT s.*, r.full_name AS repo,
       (SELECT COUNT(*) FROM findings f WHERE f.scan_id = s.id AND f.status = 'open') AS findings
     FROM scans s JOIN repositories r ON r.id = s.repo_id
     WHERE s.user_id = ? AND s.product_scan_id IN (${rows.map(() => '?').join(',')}) ORDER BY r.full_name`,
    userId,
    ...rows.map((r) => r.id),
  )
  return rows.map((ps): ProductScanItem => {
    const scans = children.filter((c) => c.product_scan_id === ps.id).map((s) => toListItem(s))
    const live = scans.some((s) => s.status === 'queued' || s.status === 'running')
    const status = live
      ? scans.some((s) => s.status === 'running') ? 'running' : 'queued'
      : scans.length && scans.every((s) => s.status === 'failed') ? 'failed'
      : scans.length && scans.every((s) => s.status === 'failed' || s.status === 'cancelled') ? 'cancelled'
      : 'completed'
    const risks = scans.map((s) => s.risk).filter((r): r is string => Boolean(r)).sort((a, b) => RISK_ORDER.indexOf(a) - RISK_ORDER.indexOf(b))
    return {
      id: ps.id,
      product_id: ps.product_id,
      product: ps.product,
      trigger: ps.trigger,
      status,
      progress: scans.length ? Math.round(scans.reduce((n, s) => n + (s.status === 'failed' || s.status === 'cancelled' ? 100 : s.progress), 0) / scans.length) : 0,
      created_at: ps.created_at,
      finished_at: live ? null : Math.max(0, ...scans.map((s) => s.finished_at ?? 0)) || null,
      risk: risks[0] ?? null,
      findings: scans.reduce((n, s) => n + s.findings, 0),
      push: ps.trigger === 'push' ? { repo: ps.push_repo, commit_sha: ps.commit_sha } : null,
      scans,
    }
  })
}

export interface FindingView {
  id: string
  scan_id: string
  repo: string
  severity: string
  category: string
  title: string
  file: string | null
  line: number | null
  description: string
  impact: string | null
  recommendation: string | null
  poc: string | null
  confidence: string | null
  priority: number | null
  status: string
  created_at: number
  verdict: string | null
  verification: string | null
  trace_json: string | null
  threat_model: string | null
  source: string | null
  skills_json: string | null
  fingerprint: string
  /** Derived product areas (Auth, Payments, …) for filtering; not stored. */
  areas: AreaId[]
}

export async function listFindings(userId: string, opts: { scanId?: string; limit?: number } = {}) {
  const where = opts.scanId ? 'f.scan_id = ?' : `f.status = 'open' AND f.scan_id IN (
      SELECT s.id FROM scans s WHERE s.user_id = ? AND s.kind = 'security' AND s.status = 'completed'
      AND s.created_at = (SELECT MAX(s2.created_at) FROM scans s2 WHERE s2.repo_id = s.repo_id AND s2.user_id = s.user_id AND s2.kind = 'security' AND s2.status = 'completed'))`
  const rows = await all<Omit<FindingView, 'areas'>>(
    `SELECT f.*, r.full_name AS repo FROM findings f JOIN repositories r ON r.id = f.repo_id
     WHERE f.user_id = ? AND ${where}
     ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
              COALESCE(f.priority, 999), f.created_at
     LIMIT ?`,
    userId,
    opts.scanId ?? userId,
    opts.limit ?? 200,
  )
  return rows.map((f): FindingView => ({ ...f, areas: areasFor(f) }))
}

export interface QuestionView {
  id: string
  repo: string | null
  question: string
  rationale: string | null
  status: string
  answer: string | null
  answer_source: string | null
  evidence: string | null
  created_at: number
}

export function listQuestions(userId: string, statuses: string[] = ['open'], repoIds?: number[]) {
  const repoFilter = repoIds?.length ? `AND q.repo_id IN (${repoIds.map(() => '?').join(',')})` : ''
  return all<QuestionView>(
    `SELECT q.*, r.full_name AS repo FROM questions q LEFT JOIN repositories r ON r.id = q.repo_id
     WHERE q.user_id = ? AND q.status IN (${statuses.map(() => '?').join(',')}) ${repoFilter}
     ORDER BY CASE q.status WHEN 'open' THEN 0 ELSE 1 END, q.created_at DESC LIMIT 100`,
    userId,
    ...statuses,
    ...(repoIds ?? []),
  )
}

export async function scanDetail(userId: string, scanId: string) {
  const scan = await first<ScanRow & { repo: string; html_url: string | null; profile_json: string | null; skills_json: string | null; codex_tasks_json: string | null; product: string | null }>(
    `SELECT s.*, r.full_name AS repo, r.html_url, r.profile_json, p.name AS product
     FROM scans s JOIN repositories r ON r.id = s.repo_id LEFT JOIN products p ON p.id = s.product_id
     WHERE s.id = ? AND s.user_id = ?`,
    scanId,
    userId,
  )
  if (!scan) return null
  const events = await all<{ id: number; ts: number; level: string; message: string }>(
    'SELECT id, ts, level, message FROM scan_events WHERE scan_id = ? ORDER BY id DESC LIMIT 200',
    scanId,
  )
  const findings = await listFindings(userId, { scanId })
  const questions = await all<QuestionView>(
    `SELECT q.*, NULL AS repo FROM questions q WHERE q.scan_id = ? ORDER BY q.created_at`,
    scanId,
  )
  const { state_json: _s, profile_json, skills_json, codex_tasks_json, ...rest } = scan
  return {
    codexTasks: parseJson<Array<{ role: string; id: string; url: string; status: string }>>(codex_tasks_json, []),
    scan: { ...rest, summary: parseJson<(Partial<ScanSummary> & { profile?: RepoProfile; openQuestions?: number }) | null>(scan.summary_json, null) },
    skills: parseJson<string[]>(skills_json, []),
    profile: parseJson<RepoProfile | null>(profile_json, null),
    events: events.reverse(),
    findings,
    questions,
  }
}
export type ScanDetail = NonNullable<Awaited<ReturnType<typeof scanDetail>>>

export interface ScanEventView {
  id: number
  ts: number
  level: string
  message: string
}

/**
 * The cheap read for following a scan: status, phase, progress and only the activity-log
 * entries after `sinceEventId` (a cursor). Clients poll this and refetch the full report
 * only when `updated_at` or `status` changes (each step bumps `updated_at`).
 */
export async function scanProgress(userId: string, scanId: string, sinceEventId = 0) {
  const scan = await first<{ id: string; status: string; phase: string; progress: number; error: string | null; updated_at: number; finished_at: number | null }>(
    'SELECT id, status, phase, progress, error, updated_at, finished_at FROM scans WHERE id = ? AND user_id = ?',
    scanId,
    userId,
  )
  if (!scan) return null
  const events = await all<ScanEventView>(
    'SELECT id, ts, level, message FROM scan_events WHERE scan_id = ? AND id > ? ORDER BY id LIMIT 200',
    scanId,
    sinceEventId,
  )
  const live = scan.status === 'queued' || scan.status === 'running'
  return {
    ...scan,
    live,
    events,
    /** Pass back as `since` on the next poll. */
    cursor: events.at(-1)?.id ?? sinceEventId,
  }
}
export type ScanProgress = NonNullable<Awaited<ReturnType<typeof scanProgress>>>
