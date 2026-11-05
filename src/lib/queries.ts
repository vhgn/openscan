/** Read models shared by server functions and the REST API. */
import { all, first, parseJson } from './db'
import type { RepoProfile, ScanRow, ScanSummary } from './types'

export interface ScanListItem {
  id: string
  repo: string
  repo_id: number
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
  return rows.map((s) => {
    const summary = parseJson<{ riskLevel?: string; headline?: string }>(s.summary_json, {})
    return {
      id: s.id,
      repo: s.repo,
      repo_id: s.repo_id,
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
}

export function listFindings(userId: string, opts: { scanId?: string; limit?: number } = {}) {
  const where = opts.scanId ? 'f.scan_id = ?' : `f.status = 'open' AND f.scan_id IN (
      SELECT s.id FROM scans s WHERE s.user_id = ? AND s.kind = 'security' AND s.status = 'completed'
      AND s.created_at = (SELECT MAX(s2.created_at) FROM scans s2 WHERE s2.repo_id = s.repo_id AND s2.user_id = s.user_id AND s2.kind = 'security' AND s2.status = 'completed'))`
  return all<FindingView>(
    `SELECT f.*, r.full_name AS repo FROM findings f JOIN repositories r ON r.id = f.repo_id
     WHERE f.user_id = ? AND ${where}
     ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
              COALESCE(f.priority, 999), f.created_at
     LIMIT ?`,
    userId,
    opts.scanId ?? userId,
    opts.limit ?? 200,
  )
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
  const scan = await first<ScanRow & { repo: string; html_url: string | null; profile_json: string | null; skills_json: string | null; codex_tasks_json: string | null }>(
    `SELECT s.*, r.full_name AS repo, r.html_url, r.profile_json FROM scans s JOIN repositories r ON r.id = s.repo_id WHERE s.id = ? AND s.user_id = ?`,
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
