/**
 * Scan engine: a resumable, step-based state machine.
 *
 * Every queue message runs exactly ONE step (fetch tree, read a batch, query
 * OSV, triage...), persists state to D1, and enqueues the next step. This keeps
 * each Worker invocation short, survives restarts, and gives the UI granular
 * progress for free.
 *
 *   understand:  init -> read* -> profile -> done        (onboarding "AI reads your repo")
 *   security:    init -> deps -> review* -> triage -> done (the security report)
 */
import { env, aiMode } from '../env'
import { all, batch, first, now, parseJson, run, uid } from '../db'
import { sha256Hex } from '../crypto'
import { backgroundLLM, type BackgroundLLM } from '../chatgpt'
import { fetchFile, fetchTree, getRepo, repoToken } from '../github/repos'
import { askJson } from '../ai/llm'
import * as A from '../ai/agents'
import { selectFiles, selectLockfiles, treeOverview } from './select-files'
import { dedupeDeps, osvFindings, parseDeps } from './deps'
import { heuristicFindings, heuristicProfile, heuristicQuestions } from './heuristics'
import {
  SEVERITIES,
  defaultPreferences,
  preferencesSchema,
  type FindingDraft,
  type Preferences,
  type RepoProfile,
  type RepoRow,
  type ScanKind,
  type ScanRow,
  type ScanSummary,
  type Severity,
  type UserRow,
} from '../types'

const MAX_FILE_CHARS = 14_000
const BATCH_CHARS = 45_000
const BATCH_FILES = 6
const MAX_ATTEMPTS = 3

interface ScanState {
  sha?: string
  overview?: string
  files?: string[]
  cursor?: number
  lockfiles?: string[]
  notes?: string[]
  filesReviewed?: number
  depsChecked?: number
  readme?: string
  manifests?: Record<string, string>
  truncatedTree?: boolean
}

// ---------------------------------------------------------------- public API

export async function createScan(userId: string, repoId: number, kind: ScanKind, trigger: string): Promise<string> {
  const active = await first<{ id: string }>(
    `SELECT id FROM scans WHERE user_id = ? AND repo_id = ? AND kind = ? AND status IN ('queued','running')`,
    userId,
    repoId,
    kind,
  )
  if (active) return active.id
  const id = uid()
  await run(
    `INSERT INTO scans (id, user_id, repo_id, kind, trigger, status, phase, progress, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', 'queued', 0, ?, ?)`,
    id,
    userId,
    repoId,
    kind,
    trigger,
    now(),
    now(),
  )
  await logEvent(id, kind === 'understand' ? 'Queued: AI will read the repository' : `Queued security scan (${trigger})`)
  await enqueue(id)
  return id
}

export async function enqueue(scanId: string, delaySeconds = 0): Promise<void> {
  const q = env().JOBS
  if (q) {
    await q.send({ scanId }, delaySeconds ? { delaySeconds } : undefined)
  } else {
    // No queue binding (e.g. misconfigured env): run inline as a best effort.
    await runStep(scanId)
  }
}

export async function loadPreferences(userId: string): Promise<Preferences> {
  const row = await first<{ json: string }>('SELECT json FROM preferences WHERE user_id = ?', userId)
  const parsed = preferencesSchema.safeParse(parseJson(row?.json, {}))
  return parsed.success ? parsed.data : defaultPreferences
}

/** Executes one step of a scan. Safe to call repeatedly (idempotent per phase). */
export async function runStep(scanId: string): Promise<void> {
  const scan = await first<ScanRow>('SELECT * FROM scans WHERE id = ?', scanId)
  if (!scan || scan.status === 'completed' || scan.status === 'failed') return
  const user = await first<UserRow>('SELECT * FROM users WHERE id = ?', scan.user_id)
  const repo = await getRepo(scan.repo_id)
  if (!user || !repo) return fail(scan, 'User or repository no longer exists')

  if (scan.status === 'queued') {
    await run(`UPDATE scans SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`, now(), now(), scan.id)
  }

  const ctx: StepCtx = {
    scan,
    user,
    repo,
    state: parseJson<ScanState>(scan.state_json, {}),
    prefs: await loadPreferences(user.id),
    llm: null,
  }

  try {
    ctx.llm = await resolveEngine(ctx)
    const result = scan.kind === 'understand' ? await understandStep(ctx) : await securityStep(ctx)
    await run(
      `UPDATE scans SET phase = ?, progress = ?, state_json = ?, attempts = 0, updated_at = ? WHERE id = ?`,
      result.phase,
      result.progress,
      JSON.stringify(ctx.state),
      now(),
      scan.id,
    )
    if (result.phase === 'done') await complete(ctx)
    else await enqueue(scan.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const attempts = scan.attempts + 1
    await logEvent(scan.id, `Step "${scan.phase}" failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${message.slice(0, 300)}`, 'error')
    if (attempts >= MAX_ATTEMPTS) return fail(scan, message)
    await run('UPDATE scans SET attempts = ?, updated_at = ? WHERE id = ?', attempts, now(), scan.id)
    await enqueue(scan.id, 10 * attempts)
  }
}

// ---------------------------------------------------------------- internals

interface StepCtx {
  scan: ScanRow
  user: UserRow
  repo: RepoRow
  state: ScanState
  prefs: Preferences
  llm: BackgroundLLM | null
}

interface StepResult {
  phase: string
  progress: number
}

async function resolveEngine(ctx: StepCtx): Promise<BackgroundLLM | null> {
  const { scan, user } = ctx
  const llm = aiMode() === 'auto' ? await backgroundLLM(user).catch(() => null) : null
  if (!scan.engine) {
    const engine = llm ? 'ai' : 'heuristic'
    await run('UPDATE scans SET engine = ?, model = ? WHERE id = ?', engine, llm?.model ?? null, scan.id)
    await logEvent(
      scan.id,
      llm ? `Using ChatGPT (${llm.model}) via the user's ChatGPT plan` : 'ChatGPT not linked — running deterministic heuristic analysis',
    )
    scan.engine = engine
  } else if (scan.engine === 'ai' && !llm) {
    await run(`UPDATE scans SET engine = 'heuristic' WHERE id = ?`, scan.id)
    await logEvent(scan.id, 'ChatGPT session unavailable — continuing with heuristics', 'warn')
    scan.engine = 'heuristic'
  }
  return scan.engine === 'ai' ? llm : null
}

async function logEvent(scanId: string, message: string, level: 'info' | 'warn' | 'error' = 'info') {
  await run('INSERT INTO scan_events (scan_id, ts, level, message) VALUES (?, ?, ?, ?)', scanId, now(), level, message)
}

async function fail(scan: ScanRow, message: string) {
  await run(
    `UPDATE scans SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
    message.slice(0, 1000),
    now(),
    now(),
    scan.id,
  )
  await logEvent(scan.id, `Scan failed: ${message.slice(0, 300)}`, 'error')
}

async function complete(ctx: StepCtx) {
  await run(
    `UPDATE scans SET status = 'completed', progress = 100, finished_at = ?, updated_at = ? WHERE id = ?`,
    now(),
    now(),
    ctx.scan.id,
  )
  await logEvent(ctx.scan.id, 'Done')
  // After the repo is understood, an onboarded user automatically gets their first report.
  if (ctx.scan.kind === 'understand') {
    const fresh = await first<{ onboarded_at: number | null }>('SELECT onboarded_at FROM users WHERE id = ?', ctx.user.id)
    const prior = await first<{ id: string }>(`SELECT id FROM scans WHERE user_id = ? AND repo_id = ? AND kind = 'security' LIMIT 1`, ctx.user.id, ctx.repo.id)
    if (fresh?.onboarded_at && !prior) await createScan(ctx.user.id, ctx.repo.id, 'security', 'onboarding')
  }
}

async function readFiles(ctx: StepCtx, paths: string[]) {
  const token = await repoToken(ctx.repo)
  const out: Array<{ path: string; content: string }> = []
  for (const path of paths) {
    try {
      const content = await fetchFile(ctx.repo, token, path, ctx.state.sha!)
      out.push({ path, content: content.length > MAX_FILE_CHARS ? `${content.slice(0, MAX_FILE_CHARS)}\n…[truncated]` : content })
    } catch {
      // deleted/binary/too large: skip
    }
  }
  return out
}

/** Takes the next batch of files from state.files within the char budget. */
function nextBatch(state: ScanState): string[] {
  const files = state.files ?? []
  const start = state.cursor ?? 0
  return files.slice(start, start + BATCH_FILES)
}

/** How many queued paths a batch consumed (skipped/unreadable files count as consumed). */
function consumed(batchPaths: string[], files: Array<{ path: string }>): number {
  if (!files.length) return batchPaths.length
  return batchPaths.indexOf(files[files.length - 1].path) + 1
}

function trimBatch(files: Array<{ path: string; content: string }>) {
  const out: typeof files = []
  let total = 0
  for (const f of files) {
    if (total + f.content.length > BATCH_CHARS && out.length) break
    out.push(f)
    total += f.content.length
  }
  return out
}

async function initTree(ctx: StepCtx, maxFiles: number, boost: string[] = []) {
  const token = await repoToken(ctx.repo)
  const tree = await fetchTree(ctx.repo, token)
  ctx.state.sha = tree.sha
  ctx.state.truncatedTree = tree.truncated
  ctx.state.overview = treeOverview(tree.entries)
  ctx.state.files = selectFiles(tree.entries, { maxFiles, maxBytesPerFile: MAX_FILE_CHARS, boost, focus: ctx.prefs.focus })
  ctx.state.lockfiles = selectLockfiles(tree.entries)
  ctx.state.cursor = 0
  ctx.state.notes = []
  ctx.state.filesReviewed = 0
  await run('UPDATE scans SET commit_sha = ? WHERE id = ?', tree.sha, ctx.scan.id)
  await logEvent(
    ctx.scan.id,
    `Fetched tree @ ${tree.sha.slice(0, 7)}: ${tree.entries.length} files, ${ctx.state.files.length} selected for ${ctx.scan.kind === 'understand' ? 'reading' : 'review'}`,
  )
  return tree.entries.map((e) => e.path)
}

// ----- questions

async function openQuestions(userId: string, repoId: number) {
  return all<{ id: string; question: string }>(
    `SELECT id, question FROM questions WHERE user_id = ? AND repo_id = ? AND status = 'open' ORDER BY created_at LIMIT 20`,
    userId,
    repoId,
  )
}

async function knownAnswers(userId: string, repoId: number) {
  return all<{ question: string; answer: string }>(
    `SELECT question, answer FROM questions WHERE user_id = ? AND (repo_id = ? OR repo_id IS NULL)
     AND status IN ('answered','auto_answered') AND answer IS NOT NULL ORDER BY answered_at DESC LIMIT 30`,
    userId,
    repoId,
  )
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

async function addQuestions(ctx: StepCtx, qs: Array<{ question: string; rationale: string; answer?: string; evidence?: string }>) {
  if (!qs.length) return
  const existing = await all<{ question: string }>('SELECT question FROM questions WHERE user_id = ? AND repo_id = ?', ctx.user.id, ctx.repo.id)
  const seen = new Set(existing.map((q) => norm(q.question)))
  const openCount = (await openQuestions(ctx.user.id, ctx.repo.id)).length
  let budget = Math.max(0, 10 - openCount)
  const ops: Array<[string, Array<string | number | null>]> = []
  for (const q of qs) {
    const key = norm(q.question)
    if (!key || seen.has(key)) continue
    if (!q.answer && budget-- <= 0) continue
    seen.add(key)
    ops.push([
      `INSERT INTO questions (id, user_id, repo_id, scan_id, question, rationale, status, answer, answer_source, evidence, created_at, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid(), ctx.user.id, ctx.repo.id, ctx.scan.id, q.question, q.rationale, q.answer ? 'auto_answered' : 'open', q.answer ?? null, q.answer ? 'ai' : null, q.evidence ?? null, now(), q.answer ? now() : null],
    ])
  }
  await batch(ops)
  const asked = ops.filter((o) => o[1][6] === 'open').length
  const selfAnswered = ops.length - asked
  if (ops.length) await logEvent(ctx.scan.id, `Raised ${asked} question(s)${selfAnswered ? `, answered ${selfAnswered} itself` : ''}`)
}

async function applyAnswers(ctx: StepCtx, answers: Array<{ questionId: string; answer: string; evidence: string }>) {
  if (!answers.length) return
  await batch(
    answers.map((a) => [
      `UPDATE questions SET status = 'auto_answered', answer = ?, evidence = ?, answer_source = 'ai', answered_at = ?
       WHERE id = ? AND user_id = ? AND status = 'open'`,
      [a.answer, a.evidence, now(), a.questionId, ctx.user.id],
    ]),
  )
  await logEvent(ctx.scan.id, `AI answered ${answers.length} of its own open question(s) while reading`)
}

// ----- findings

async function saveFindings(ctx: StepCtx, drafts: FindingDraft[]) {
  if (!drafts.length) return
  const ops: Array<[string, Array<string | number | null>]> = []
  const existing = new Set(
    (await all<{ fingerprint: string }>('SELECT fingerprint FROM findings WHERE scan_id = ?', ctx.scan.id)).map((f) => f.fingerprint),
  )
  for (const f of drafts) {
    const fp = await sha256Hex(`${ctx.repo.id}|${f.category}|${norm(f.title)}|${f.file ?? ''}`)
    if (existing.has(fp)) continue
    existing.add(fp)
    ops.push([
      `INSERT INTO findings (id, scan_id, repo_id, user_id, severity, category, title, file, line, description, impact, recommendation, poc, confidence, fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid(), ctx.scan.id, ctx.repo.id, ctx.user.id, f.severity, f.category, f.title, f.file ?? null, f.line ?? null, f.description, f.impact ?? null, f.recommendation ?? null, f.poc ?? null, f.confidence ?? 'medium', fp, now()],
    ])
  }
  await batch(ops)
}

// ---------------------------------------------------------------- understand

async function understandStep(ctx: StepCtx): Promise<StepResult> {
  const { scan, state } = ctx
  switch (scan.phase) {
    case 'queued':
    case 'init': {
      const paths = await initTree(ctx, 30)
      if (!ctx.llm) await addQuestions(ctx, heuristicQuestions(paths))
      return { phase: 'read', progress: 10 }
    }
    case 'read': {
      const batchPaths = nextBatch(state)
      if (!batchPaths.length) return { phase: 'profile', progress: 88 }
      const files = trimBatch(await readFiles(ctx, batchPaths))
      state.cursor = (state.cursor ?? 0) + consumed(batchPaths, files)
      state.filesReviewed = (state.filesReviewed ?? 0) + files.length
      if (ctx.llm) {
        const out = await askJson(ctx.llm, {
          system: A.READER_SYSTEM,
          prompt: A.readerPrompt({
            repo: ctx.repo.full_name,
            overview: state.overview ?? '',
            notes: state.notes ?? [],
            openQuestions: await openQuestions(ctx.user.id, ctx.repo.id),
            files,
            userContext: ctx.prefs.context,
          }),
          schema: A.readerOutput,
          effort: 'low',
        })
        state.notes = [...(state.notes ?? []), ...out.notes].slice(-60)
        await applyAnswers(ctx, out.answers)
        await addQuestions(ctx, out.questions.slice(0, 3))
      } else {
        for (const f of files) {
          if (/(^|\/)README(\.md)?$/i.test(f.path) && !state.readme) state.readme = f.content.slice(0, 2000)
          if (/package\.json$|requirements|go\.mod|Cargo\.toml/.test(f.path)) {
            state.manifests = { ...(state.manifests ?? {}), [f.path]: f.content.slice(0, 3000) }
          }
        }
      }
      await logEvent(scan.id, `Read ${files.map((f) => f.path).join(', ') || '(nothing readable)'}`)
      const total = state.files?.length || 1
      return { phase: 'read', progress: Math.min(85, 10 + Math.round((75 * (state.cursor ?? 0)) / total)) }
    }
    case 'profile': {
      let profile: RepoProfile
      if (ctx.llm) {
        const out = await askJson(ctx.llm, {
          system: A.PROFILE_SYSTEM,
          prompt: A.profilePrompt({
            repo: ctx.repo.full_name,
            overview: state.overview ?? '',
            notes: state.notes ?? [],
            openQuestions: await openQuestions(ctx.user.id, ctx.repo.id),
            userContext: ctx.prefs.context,
          }),
          schema: A.profileOutput,
          effort: 'medium',
        })
        const { answers, ...rest } = out
        profile = rest
        await applyAnswers(ctx, answers)
      } else {
        profile = heuristicProfile(state.files ?? [], state.manifests ?? {}, state.readme)
      }
      await run('UPDATE repositories SET profile_json = ?, understood_at = ?, updated_at = ? WHERE id = ?', JSON.stringify(profile), now(), now(), ctx.repo.id)
      const open = (await openQuestions(ctx.user.id, ctx.repo.id)).length
      await run(
        'UPDATE scans SET summary_json = ? WHERE id = ?',
        JSON.stringify({ profile, filesReviewed: state.filesReviewed ?? 0, openQuestions: open }),
        scan.id,
      )
      await logEvent(scan.id, `Built repository profile (${profile.stack.join(', ') || 'stack unknown'}); ${open} question(s) still need you`)
      return { phase: 'done', progress: 100 }
    }
    default:
      return { phase: 'init', progress: 0 }
  }
}

// ---------------------------------------------------------------- security

async function securityStep(ctx: StepCtx): Promise<StepResult> {
  const { scan, state, prefs } = ctx
  const profile = parseJson<RepoProfile | null>(ctx.repo.profile_json, null)
  switch (scan.phase) {
    case 'queued':
    case 'init': {
      const maxFiles = prefs.depth === 'triage' ? 20 : prefs.depth === 'deep_poc' ? 50 : 35
      await initTree(ctx, maxFiles, profile?.sensitiveAreas ?? [])
      return { phase: prefs.focus.includes('dependencies') ? 'deps' : 'review', progress: 8 }
    }
    case 'deps': {
      const files = await readFiles(ctx, state.lockfiles ?? [])
      // Prefer lockfiles over package.json when both exist in the same dir.
      const deps = dedupeDeps(files.flatMap((f) => parseDeps(f.path, f.content)))
      state.depsChecked = deps.length
      const found = await osvFindings(deps).catch(async (e) => {
        await logEvent(scan.id, `OSV lookup failed: ${String(e).slice(0, 200)}`, 'warn')
        return []
      })
      await saveFindings(ctx, found)
      await logEvent(scan.id, `Checked ${deps.length} dependencies against OSV.dev: ${found.length} vulnerable package(s)`)
      return { phase: 'review', progress: 18 }
    }
    case 'review': {
      const batchPaths = nextBatch(state)
      if (!batchPaths.length) return { phase: 'triage', progress: 88 }
      const files = trimBatch(await readFiles(ctx, batchPaths))
      state.cursor = (state.cursor ?? 0) + consumed(batchPaths, files)
      state.filesReviewed = (state.filesReviewed ?? 0) + files.length
      const hints = files.flatMap((f) => heuristicFindings(f.path, f.content))
      if (ctx.llm) {
        const out = await askJson(ctx.llm, {
          system: A.reviewSystem(prefs),
          prompt: A.reviewPrompt({
            repo: ctx.repo.full_name,
            profile,
            knownAnswers: await knownAnswers(ctx.user.id, ctx.repo.id),
            openQuestions: await openQuestions(ctx.user.id, ctx.repo.id),
            files: files.map((f) => ({
              path: f.path,
              content: `${hints.filter((h) => h.file === f.path).map((h) => `// static-analyzer hint (verify, may be false positive): ${h.title} @ line ${h.line}`).join('\n')}\n${f.content}`,
            })),
            userContext: prefs.context,
          }),
          schema: A.reviewOutput,
          effort: prefs.depth === 'triage' ? 'low' : 'medium',
        })
        await saveFindings(ctx, out.findings)
        await applyAnswers(ctx, out.answers)
        await addQuestions(ctx, out.questions.slice(0, 2))
        await logEvent(scan.id, `Reviewed ${files.map((f) => f.path).join(', ')} → ${out.findings.length} finding(s)`)
      } else {
        await saveFindings(ctx, hints)
        await logEvent(scan.id, `Pattern-scanned ${files.map((f) => f.path).join(', ')} → ${hints.length} finding(s)`)
      }
      const total = state.files?.length || 1
      return { phase: 'review', progress: Math.min(85, 18 + Math.round((67 * (state.cursor ?? 0)) / total)) }
    }
    case 'triage': {
      await triage(ctx, profile)
      return { phase: 'done', progress: 100 }
    }
    default:
      return { phase: 'init', progress: 0 }
  }
}

const SEV_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

async function triage(ctx: StepCtx, profile: RepoProfile | null) {
  const { scan, state, prefs } = ctx
  const rows = await all<{ id: string; severity: Severity; category: string; title: string; file: string | null; description: string; confidence: string; recommendation: string | null }>(
    'SELECT id, severity, category, title, file, description, confidence, recommendation FROM findings WHERE scan_id = ? ORDER BY created_at',
    scan.id,
  )
  let summary: ScanSummary
  if (ctx.llm && rows.length) {
    const out = await askJson(ctx.llm, {
      system: A.triageSystem(prefs),
      prompt: A.triagePrompt({
        repo: ctx.repo.full_name,
        profile,
        knownAnswers: await knownAnswers(ctx.user.id, ctx.repo.id),
        findings: rows.slice(0, 80).map((r, index) => ({ index, ...r })),
      }),
      schema: A.triageOutput,
      effort: prefs.depth === 'deep_poc' ? 'high' : 'medium',
    })
    const ops: Array<[string, Array<string | number | null>]> = []
    for (const r of out.ranking) {
      const row = rows[r.index]
      if (!row) continue
      ops.push([
        `UPDATE findings SET priority = ?, severity = ?, status = ? WHERE id = ?`,
        [r.priority, r.severity, r.falsePositive ? 'dismissed' : 'open', row.id],
      ])
    }
    for (const p of out.research) {
      const row = rows[p.index]
      if (row) ops.push(['UPDATE findings SET poc = ? WHERE id = ?', [p.poc, row.id]])
    }
    await batch(ops)
    summary = { headline: out.headline, riskLevel: out.riskLevel, whatMatters: out.whatMatters, nextActions: out.nextActions, stats: emptyStats(), filesReviewed: 0, dependenciesChecked: 0 }
    await logEvent(scan.id, `Triage: ranked ${out.ranking.length} finding(s)${out.research.length ? `, wrote ${out.research.length} PoC(s)` : ''}`)
  } else {
    // Deterministic triage: severity × confidence.
    const conf = { high: 3, medium: 2, low: 1 } as Record<string, number>
    const ranked = [...rows].sort((a, b) => SEV_RANK[b.severity] * 3 + (conf[b.confidence] ?? 1) - (SEV_RANK[a.severity] * 3 + (conf[a.confidence] ?? 1)))
    await batch(ranked.map((r, i) => ['UPDATE findings SET priority = ? WHERE id = ?', [i + 1, r.id]]))
    const top = ranked[0]
    const worst = top?.severity ?? 'info'
    summary = {
      headline: top ? `Fix first: ${top.title}${top.file ? ` (${top.file})` : ''}.` : 'No security issues detected in the reviewed files.',
      riskLevel: !top ? 'none' : worst === 'info' ? 'low' : worst,
      whatMatters: ranked.slice(0, 4).map((r) => `${r.severity.toUpperCase()}: ${r.title}`),
      nextActions: ranked.slice(0, 3).map((r) => ({ action: r.recommendation ?? `Investigate ${r.title}`, why: r.title, effort: 'small' as const })),
      stats: emptyStats(),
      filesReviewed: 0,
      dependenciesChecked: 0,
      engineNote: 'Heuristic mode: link ChatGPT for AI-verified findings, false-positive filtering and research.',
    }
  }
  const counts = await all<{ severity: Severity; n: number }>(
    `SELECT severity, COUNT(*) AS n FROM findings WHERE scan_id = ? AND status = 'open' GROUP BY severity`,
    scan.id,
  )
  for (const c of counts) summary.stats[c.severity] = c.n
  summary.filesReviewed = state.filesReviewed ?? 0
  summary.dependenciesChecked = state.depsChecked ?? 0
  await run('UPDATE scans SET summary_json = ? WHERE id = ?', JSON.stringify(summary), scan.id)
}

function emptyStats(): Record<Severity, number> {
  return Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>
}

// ---------------------------------------------------------------- scheduling

const INTERVAL: Record<string, number> = { daily: 86_400_000, weekly: 7 * 86_400_000, monthly: 30 * 86_400_000 }

/** Cron: start recurring reports per user preference + revive stalled scans. */
export async function scheduledTick(): Promise<void> {
  const stalled = await all<{ id: string }>(
    `SELECT id FROM scans WHERE status IN ('queued','running') AND updated_at < ? LIMIT 50`,
    now() - 10 * 60_000,
  )
  for (const s of stalled) await enqueue(s.id)

  const users = await all<{ id: string; json: string }>(
    `SELECT u.id, p.json FROM users u JOIN preferences p ON p.user_id = u.id WHERE u.onboarded_at IS NOT NULL`,
  )
  for (const u of users) {
    const prefs = preferencesSchema.safeParse(parseJson(u.json, {}))
    const freq = prefs.success ? prefs.data.frequency : 'manual'
    const interval = INTERVAL[freq]
    if (!interval) continue
    const repos = await all<{ repo_id: number }>('SELECT repo_id FROM user_repositories WHERE user_id = ? AND selected = 1', u.id)
    for (const r of repos) {
      const last = await first<{ created_at: number }>(
        `SELECT created_at FROM scans WHERE user_id = ? AND repo_id = ? AND kind = 'security' ORDER BY created_at DESC LIMIT 1`,
        u.id,
        r.repo_id,
      )
      if (!last || last.created_at < now() - interval) await createScan(u.id, r.repo_id, 'security', 'schedule')
    }
  }
}
