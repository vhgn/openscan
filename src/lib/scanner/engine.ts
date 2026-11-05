/**
 * Scan engine: a resumable, step-based state machine.
 *
 * Every queue message runs exactly ONE step (fetch tree, read a batch, query
 * OSV, triage...), persists state to D1, and enqueues the next step. This keeps
 * each Worker invocation short, survives restarts, and gives the UI granular
 * progress for free.
 *
 *   understand:  init -> read* -> profile -> done                      (onboarding "AI reads your repo")
 *   security:    init -> deps -> review* -> validate* -> triage -> done  (the security report)
 *
 * Codex engine (user has a Codex Cloud environment for the repo): the agent work runs as
 * Codex Cloud tasks on the user's ChatGPT plan, polled via delayed queue messages:
 *   understand:  init -> codex_recon -> codex_recon_wait* -> done
 *   security:    init -> deps -> codex_hunt -> codex_hunt_wait* -> codex_validate -> codex_validate_wait* -> triage
 * Any Codex failure falls back to the direct engine (read* or review*) for that scan.
 *
 * Methodology comes from vendored agentic security skills (src/lib/skills, SKILLS.md):
 * recon = ToB audit-context-building + Cloudflare recon; review = Cloudflare hunting +
 * Anthropic security-review (+ ToB differential-review on push, agentic-actions /
 * SkillSpector for CI & agent config); validate = ToB fp-check + brocards + Cloudflare
 * fresh verifier; deps = OSV + ToB supply-chain / brotli-checker + OpenAI php2shell +
 * Cognition fix data + GitHub code-scanning (ToB static-analysis); report = Cloudflare
 * reporting + ToB patching-bugs.
 */
import { env, aiMode } from '../env'
import { all, batch, exec, first, now, parseJson, run, uid } from '../db'
import { sha256Hex } from '../crypto'
import { backgroundLLM, type BackgroundLLM } from '../chatgpt'
import { fetchChangedFiles, fetchCodeScanningAlerts, fetchFile, fetchTree, getRepo, repoToken } from '../github/repos'
import { askJson } from '../ai/llm'
import type { z } from 'zod'
import * as A from '../ai/agents'
import { selectFiles, selectLockfiles, treeOverview } from './select-files'
import { dedupeDeps, osvFindings, parseDeps } from './deps'
import { heuristicFindings, heuristicProfile, heuristicQuestions } from './heuristics'
import { brotliFindings, installScriptPackages, runtimeFindings, selectRuntimeFiles } from './runtime-advisories'
import { huntPlaybook, reconPlaybook, reportPlaybook, validatePlaybook } from '../skills/playbooks'
import { tracePaths } from './trace'
import { similarQuestion } from '../memory-match'
import { acquireLease, releaseLease, STALL_MS, STALLED_SCANS_SQL } from './lease'
import { codexClientFor, codexEnvironmentFor } from '../codex/runtime'
import { environmentsSettingsUrl, taskUrl } from '../codex/cloud'
import * as CP from '../codex/prompts'
import { attachTask, issueAgentToken, revokeAgentToken, revokeScanTokens, setCodexNet } from '../codex/agent-tokens'
import {
  ensureDefaultProduct,
  memoryContext,
  memoryHit,
  priorVerdict,
  productForRepo,
  productRepoIds,
  rememberFacts,
  rememberReviewed,
  rememberVerdict,
  unchangedReviewed,
  verdictMemory,
  type ProductRow,
  type VerdictMemory,
} from '../products'
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

export interface ScanState {
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
  /** Push range for differential scans (set by the webhook). */
  diff?: { base: string; head: string }
  /** Files changed in that range. */
  changed?: string[]
  runtimeFiles?: string[]
  /** Finding ids awaiting independent validation. */
  validateQueue?: string[]
  validateTotal?: number
  /** Skill ids applied so far in this scan. */
  skills?: string[]
  /** Blob hashes of candidate files (product memory). */
  hashes?: Record<string, string>
  /** Files skipped because product memory says they were reviewed at this exact version. */
  memorySkipped?: string[]
  /** Findings whose verdict was reused from product memory. */
  memoryVerdicts?: number
  /** Open findings carried over from earlier scans for the files product memory skipped. */
  memoryCarried?: number
  /** Codex Cloud runtime state. */
  codex?: { envId: string; envLabel: string | null; tasks: Partial<Record<CP.CodexRole, { id: string; startedAt: number; status?: string; tokenHash?: string }>> }
}

// ---------------------------------------------------------------- public API

/**
 * Queues one repository job. Security scans belong to a product scan (see `startProductScan`);
 * `understand` scans (reading a repo) stand alone. A repo already being scanned keeps its running job.
 */
export async function createScan(
  userId: string,
  repoId: number,
  kind: ScanKind,
  trigger: string,
  initialState: Partial<ScanState> = {},
  productScanId: string | null = null,
): Promise<string> {
  return (await createScanOnce(userId, repoId, kind, trigger, initialState, productScanId)).id
}

/**
 * Starts a scan unless one of the same kind is already active for this user and repo, in which
 * case that scan is returned with `existing: true`. Safe under concurrency: the partial unique
 * index `scans_one_active` (migration 0011) makes the database the arbiter, so two simultaneous
 * requests can never queue two scans.
 */
export async function createScanOnce(
  userId: string,
  repoId: number,
  kind: ScanKind,
  trigger: string,
  initialState: Partial<ScanState> = {},
  productScanId: string | null = null,
): Promise<{ id: string; existing: boolean }> {
  const activeScan = () =>
    first<{ id: string }>(`SELECT id FROM scans WHERE user_id = ? AND repo_id = ? AND kind = ? AND status IN ('queued','running')`, userId, repoId, kind)
  const active = await activeScan()
  if (active) return { id: active.id, existing: true }
  const id = uid()
  try {
    await run(
      `INSERT INTO scans (id, user_id, repo_id, kind, trigger, status, phase, progress, state_json, created_at, updated_at, product_id, product_scan_id)
       VALUES (?, ?, ?, ?, ?, 'queued', 'queued', 0, ?, ?, ?, ?, ?)`,
      id,
      userId,
      repoId,
      kind,
      trigger,
      JSON.stringify(initialState),
      now(),
      now(),
      (await productForRepo(userId, repoId))?.id ?? null,
      productScanId,
    )
  } catch (err) {
    // Lost the race to a concurrent request: hand back the scan that won.
    if (!isUniqueViolation(err)) throw err
    const winner = await activeScan()
    if (winner) return { id: winner.id, existing: true }
    throw err
  }
  await logEvent(id, kind === 'understand' ? 'Queued: AI will read the repository' : `Queued security scan (${trigger})`)
  await enqueue(id)
  return { id, existing: false }
}

export function isUniqueViolation(err: unknown): boolean {
  return /UNIQUE constraint failed/i.test(err instanceof Error ? err.message : String(err))
}

export type CancelResult = { ok: true } | { ok: false; reason: 'not_found' } | { ok: false; reason: 'not_active'; status: string }

/**
 * Cancels a queued or running scan. The step in flight (if any) finishes, but its final write is
 * fenced on status, so nothing moves a cancelled scan again and the next queued step exits
 * immediately (the lease only goes to active scans). Findings already written are kept.
 */
export async function cancelScan(userId: string, scanId: string): Promise<CancelResult> {
  const cancelled = await first<{ id: string }>(
    `UPDATE scans SET status = 'cancelled', finished_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status IN ('queued','running') RETURNING id`,
    now(),
    now(),
    scanId,
    userId,
  )
  if (cancelled) {
    await revokeScanTokens(scanId) // Codex tasks lose product-memory access right away
    await logEvent(scanId, 'Cancelled by the user', 'warn')
    return { ok: true }
  }
  const scan = await first<{ status: string }>('SELECT status FROM scans WHERE id = ? AND user_id = ?', scanId, userId)
  return scan ? { ok: false, reason: 'not_active', status: scan.status } : { ok: false, reason: 'not_found' }
}

/**
 * Starts a security review of a product: one product scan that owns a repository scan per
 * member repo (or only `repoIds`, e.g. the repo that was pushed). Repos already being scanned
 * keep their running scan. Returns the new product scan (or the running one when nothing new
 * started, `id: null` if that scan predates product scans), or null when the product has no such repos.
 */
export async function startProductScan(
  userId: string,
  productId: string,
  trigger: string,
  opts: { repoIds?: number[]; state?: Partial<ScanState>; push?: { repoId: number; commitSha: string | null } } = {},
): Promise<{ id: string | null; scanIds: string[] } | null> {
  // Only repos the user still has through the GitHub App (detached repos keep their history but aren't scanned).
  const linked = new Set(
    (
      await all<{ repo_id: number }>(
        `SELECT ur.repo_id FROM user_repositories ur JOIN repositories r ON r.id = ur.repo_id
         WHERE ur.user_id = ? AND r.removed_at IS NULL`,
        userId,
      )
    ).map((r) => r.repo_id),
  )
  const members = (await productRepoIds(productId)).filter((r) => linked.has(r))
  const repoIds = opts.repoIds ? opts.repoIds.filter((r) => members.includes(r)) : members
  if (!repoIds.length) return null
  const id = uid()
  await run(
    `INSERT INTO product_scans (id, product_id, user_id, kind, trigger, push_repo_id, commit_sha, created_at) VALUES (?, ?, ?, 'security', ?, ?, ?, ?)`,
    id,
    productId,
    userId,
    trigger,
    opts.push?.repoId ?? null,
    opts.push?.commitSha ?? null,
    now(),
  )
  const scanIds: string[] = []
  for (const repoId of repoIds) scanIds.push(await createScan(userId, repoId, 'security', trigger, opts.state ?? {}, id))
  const owned = await first<{ n: number }>('SELECT COUNT(*) AS n FROM scans WHERE product_scan_id = ?', id)
  if (owned?.n) return { id, scanIds }
  // Every repo already had a scan running: point at that review instead of an empty one.
  await run('DELETE FROM product_scans WHERE id = ?', id)
  const running = await first<{ product_scan_id: string | null }>(`SELECT product_scan_id FROM scans WHERE id = ?`, scanIds[0])
  return { id: running?.product_scan_id ?? null, scanIds }
}

/** The product a repo belongs to, creating the user's default product if it has none. */
export async function productIdForRepo(userId: string, repoId: number, fallbackName: string): Promise<string> {
  const owner = await productForRepo(userId, repoId)
  if (owner) return owner.id
  await ensureDefaultProduct(userId, fallbackName, [repoId])
  return (await productForRepo(userId, repoId))!.id
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

/**
 * Executes one step of a scan. Safe to call repeatedly and concurrently: a step lease
 * (./lease.ts) makes a duplicate delivery a no-op while another worker runs the step.
 */
export async function runStep(scanId: string): Promise<void> {
  const leaseId = uid()
  if (!(await acquireLease(exec, scanId, leaseId, now()))) return // finished, or another worker holds it
  let next: number | null = null
  try {
    next = await leasedStep(scanId, leaseId)
  } finally {
    await releaseLease(exec, scanId, leaseId)
  }
  // Enqueue only after releasing, so the next step (or the inline fallback) can take the lease.
  if (next !== null) await enqueue(scanId, next)
}

/** Runs one step while holding the lease. Returns the delay before the next step, or null when there is none. */
async function leasedStep(scanId: string, leaseId: string): Promise<number | null> {
  const scan = await first<ScanRow>('SELECT * FROM scans WHERE id = ?', scanId)
  if (!scan || (scan.status !== 'queued' && scan.status !== 'running')) return null // completed, failed or cancelled
  // Everything after loading the scan counts as the step: a crash while setting it up
  // (loading the user, preferences, product) uses an attempt like any other failure,
  // instead of escaping to the queue and being revived by the cron forever.
  try {
    return await runLoadedStep(scan, leaseId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const attempts = scan.attempts + 1
    await logEvent(scan.id, `Step "${scan.phase}" failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${message.slice(0, 300)}`, 'error')
    if (attempts >= MAX_ATTEMPTS) return fail(scan, leaseId, message)
    if (!(await exec('UPDATE scans SET attempts = ?, updated_at = ? WHERE id = ? AND lease_id = ?', attempts, now(), scan.id, leaseId))) return lostLease(scan)
    return 10 * attempts
  }
}

async function runLoadedStep(scan: ScanRow, leaseId: string): Promise<number | null> {
  const user = await first<UserRow>('SELECT * FROM users WHERE id = ?', scan.user_id)
  const repo = await getRepo(scan.repo_id)
  if (!user || !repo) return fail(scan, leaseId, 'User or repository no longer exists')
  if (repo.removed_at) return fail(scan, leaseId, `${repo.full_name} was removed from the GitHub App`)

  if (scan.status === 'queued') {
    await run(`UPDATE scans SET status = 'running', started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'`, now(), now(), scan.id)
  }

  const ctx: StepCtx = {
    scan,
    user,
    repo,
    state: parseJson<ScanState>(scan.state_json, {}),
    prefs: await loadPreferences(user.id),
    ownerContext: '',
    memory: '',
    llm: null,
    product: (await productForRepo(user.id, repo.id)) ?? null,
  }
  ctx.ownerContext = ctx.prefs.context
  if (!ctx.product) {
    // Every repo lives in a product so memory always has a home.
    await ensureDefaultProduct(user.id, repo.full_name.split('/')[0], [repo.id])
    ctx.product = await productForRepo(user.id, repo.id)
  }

  {
    ctx.llm = await resolveEngine(ctx)
    // Polling a running Codex task never builds a prompt, so it needs no memory.
    const polling = scan.engine === 'codex' && scan.phase.endsWith('_wait')
    if (ctx.llm && ctx.product && !polling) {
      ctx.memory = await memoryContext(ctx.product.id, repo.id, { skipPaths: ctx.state.memorySkipped })
      if (ctx.memory) ctx.prefs = { ...ctx.prefs, context: [ctx.prefs.context, ctx.memory].filter(Boolean).join('\n\n') }
    }
    const result = scan.kind === 'understand' ? await understandStep(ctx) : await securityStep(ctx)
    const saved = await exec(
      `UPDATE scans SET phase = ?, progress = ?, state_json = ?, skills_json = ?, attempts = 0, updated_at = ? WHERE id = ? AND lease_id = ?`,
      result.phase,
      result.progress,
      JSON.stringify(ctx.state),
      JSON.stringify(ctx.state.skills ?? []),
      now(),
      scan.id,
      leaseId,
    )
    if (!saved) return lostLease(scan)
    if (result.phase === 'done') {
      await complete(ctx, leaseId)
      return null
    }
    return result.delay ?? 0
  }
}

/** A fenced final write changed nothing: the user cancelled the scan meanwhile, or the lease was lost. */
async function notApplied(scan: ScanRow): Promise<null> {
  const current = await first<{ status: string }>('SELECT status FROM scans WHERE id = ?', scan.id)
  if (current?.status === 'cancelled') return null
  return lostLease(scan)
}

/** Our lease expired and another worker took the scan over: drop this step's result, the new holder continues. */
async function lostLease(scan: ScanRow): Promise<null> {
  await logEvent(scan.id, `Step "${scan.phase}" outlived its lease; its result was discarded`, 'warn')
  return null
}

// ---------------------------------------------------------------- internals

interface StepCtx {
  scan: ScanRow
  user: UserRow
  repo: RepoRow
  state: ScanState
  /** Preferences; for AI engines `context` also carries the product memory block. */
  prefs: Preferences
  /** The owner's own context, without memory (Codex prompts keep the two apart). */
  ownerContext: string
  /** Inline product memory summary ('' when none or not needed this step). */
  memory: string
  llm: BackgroundLLM | null
  product: ProductRow | null
  /** Lazily loaded validator verdicts remembered for this repo. */
  verdicts?: VerdictMemory[]
}

interface StepResult {
  phase: string
  progress: number
  /** Seconds before the next step runs (used to poll Codex Cloud tasks). */
  delay?: number
}

async function resolveEngine(ctx: StepCtx): Promise<BackgroundLLM | null> {
  const { scan, user } = ctx
  const mode = aiMode()
  const llm = mode === 'auto' ? await backgroundLLM(user).catch(() => null) : null
  if (!scan.engine) {
    let engine = llm ? 'ai' : 'heuristic'
    if (llm) {
      const client = await codexClientFor(user).catch(() => null)
      const env = client ? await codexEnvironmentFor(user.id, ctx.repo, client).catch(() => null) : null
      if (env) {
        engine = 'codex'
        ctx.state.codex = { envId: env.id, envLabel: env.label, tasks: {} }
        await logEvent(scan.id, `Using Codex Cloud tasks in environment "${env.label ?? env.id}" on the user's ChatGPT plan`)
      } else {
        await logEvent(scan.id, `No Codex Cloud environment for ${ctx.repo.full_name} (create one at ${environmentsSettingsUrl()}); using direct ChatGPT review`)
      }
    }
    await run('UPDATE scans SET engine = ?, model = ? WHERE id = ?', engine, engine === 'codex' ? 'codex-cloud' : (llm?.model ?? null), scan.id)
    if (engine !== 'codex') {
      await logEvent(
        scan.id,
        llm ? `Using ChatGPT (${llm.model}) via the user's ChatGPT plan` : 'ChatGPT not linked — running deterministic heuristic analysis',
      )
    }
    scan.engine = engine
  } else if ((scan.engine === 'ai' || scan.engine === 'codex') && !llm) {
    await run(`UPDATE scans SET engine = 'heuristic' WHERE id = ?`, scan.id)
    await logEvent(scan.id, 'ChatGPT session unavailable — continuing with heuristics', 'warn')
    scan.engine = 'heuristic'
  }
  return scan.engine === 'ai' || scan.engine === 'codex' ? llm : null
}

async function logEvent(scanId: string, message: string, level: 'info' | 'warn' | 'error' = 'info') {
  await run('INSERT INTO scan_events (scan_id, ts, level, message) VALUES (?, ?, ?, ?)', scanId, now(), level, message)
}

async function fail(scan: ScanRow, leaseId: string, message: string): Promise<null> {
  const changed = await exec(
    `UPDATE scans SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ? AND lease_id = ? AND status IN ('queued','running')`,
    message.slice(0, 1000),
    now(),
    now(),
    scan.id,
    leaseId,
  )
  if (!changed) return notApplied(scan)
  await revokeScanTokens(scan.id)
  await logEvent(scan.id, `Scan failed: ${message.slice(0, 300)}`, 'error')
  return null
}

async function complete(ctx: StepCtx, leaseId: string) {
  const changed = await exec(
    `UPDATE scans SET status = 'completed', progress = 100, finished_at = ?, updated_at = ? WHERE id = ? AND lease_id = ? AND status = 'running'`,
    now(),
    now(),
    ctx.scan.id,
    leaseId,
  )
  if (!changed) {
    await notApplied(ctx.scan)
    return
  }
  await revokeScanTokens(ctx.scan.id)
  await logEvent(ctx.scan.id, 'Done')
  // After the repo is understood, an onboarded user automatically gets their first report.
  if (ctx.scan.kind === 'understand') {
    const fresh = await first<{ onboarded_at: number | null }>('SELECT onboarded_at FROM users WHERE id = ?', ctx.user.id)
    const prior = await first<{ id: string }>(`SELECT id FROM scans WHERE user_id = ? AND repo_id = ? AND kind = 'security' LIMIT 1`, ctx.user.id, ctx.repo.id)
    if (fresh?.onboarded_at && !prior && ctx.product) await joinOnboardingReview(ctx.user.id, ctx.product.id, ctx.repo.id)
  }
}

/**
 * First report for a repo that just finished reading: it joins the product's onboarding review
 * while that review is still running, otherwise it gets a product scan of its own.
 */
export async function joinOnboardingReview(userId: string, productId: string, repoId: number) {
  const open = await first<{ id: string }>(
    `SELECT ps.id FROM product_scans ps WHERE ps.product_id = ? AND ps.trigger = 'onboarding'
     AND EXISTS (SELECT 1 FROM scans s WHERE s.product_scan_id = ps.id AND s.status IN ('queued','running'))
     ORDER BY ps.created_at DESC LIMIT 1`,
    productId,
  )
  if (open) await createScan(userId, repoId, 'security', 'onboarding', {}, open.id)
  else await startProductScan(userId, productId, 'onboarding', { repoIds: [repoId] })
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

/** Records that a skill contributed to this scan (shown on the report). */
function useSkills(ctx: StepCtx, ids: string[]) {
  ctx.state.skills = [...new Set([...(ctx.state.skills ?? []), ...ids])]
}

async function initTree(ctx: StepCtx, maxFiles: number, boost: string[] = []) {
  const token = await repoToken(ctx.repo)
  const tree = await fetchTree(ctx.repo, token)
  ctx.state.sha = tree.sha
  ctx.state.truncatedTree = tree.truncated
  ctx.state.overview = treeOverview(tree.entries)
  if (ctx.state.diff && ctx.scan.kind === 'security') {
    // Trail of Bits differential-review: changed files are reviewed first.
    const changed = await fetchChangedFiles(ctx.repo, token, ctx.state.diff.base, ctx.state.diff.head).catch(() => [])
    const present = new Set(tree.entries.map((e) => e.path))
    ctx.state.changed = changed.filter((p) => present.has(p))
    if (ctx.state.changed.length) {
      useSkills(ctx, ['tob-differential-review'])
      await logEvent(ctx.scan.id, `Differential review: ${ctx.state.changed.length} file(s) changed in ${ctx.state.diff.base.slice(0, 7)}..${ctx.state.diff.head.slice(0, 7)} are reviewed first`)
    }
  }
  // Product memory: skip files already reviewed at this exact blob hash (security scans only).
  let candidates = tree.entries
  const hashes = Object.fromEntries(
    selectFiles(tree.entries, { maxFiles: 400, maxBytesPerFile: MAX_FILE_CHARS, focus: ctx.prefs.focus })
      .map((p) => [p, tree.entries.find((e) => e.path === p)?.sha ?? ''])
      .filter(([, h]) => h),
  ) as Record<string, string>
  ctx.state.hashes = hashes
  ctx.state.memorySkipped = []
  if (ctx.scan.kind === 'security' && ctx.product) {
    const mem = await unchangedReviewed(ctx.product.id, ctx.repo.id, hashes, ctx.prefs)
    const changed = new Set(ctx.state.changed ?? [])
    const skip = [...mem.paths].filter((p) => !changed.has(p))
    if (skip.length) {
      const skipSet = new Set(skip)
      candidates = tree.entries.filter((e) => !skipSet.has(e.path))
      ctx.state.memorySkipped = skip.slice(0, 200)
      await memoryHit(mem.ids)
      await logEvent(ctx.scan.id, `Product memory: skipping ${skip.length} file(s) already reviewed at their current version`)
      ctx.state.memoryCarried = await carryFindings(ctx, skip, mem.reviewedBy)
    }
  }
  ctx.state.files = selectFiles(candidates, { maxFiles, maxBytesPerFile: MAX_FILE_CHARS, boost, focus: ctx.prefs.focus, priority: ctx.state.changed })
  ctx.state.lockfiles = selectLockfiles(tree.entries)
  ctx.state.runtimeFiles = selectRuntimeFiles(tree.entries)
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

/** Questions are shared across the product: an answer for one repo serves all of them. */
const Q_SCOPE = `user_id = ? AND (repo_id = ? OR (product_id IS NOT NULL AND product_id = ?))`

async function openQuestions(ctx: StepCtx) {
  return all<{ id: string; question: string }>(
    `SELECT id, question FROM questions WHERE ${Q_SCOPE} AND status = 'open' ORDER BY created_at LIMIT 20`,
    ctx.user.id,
    ctx.repo.id,
    ctx.product?.id ?? null,
  )
}

async function knownAnswers(ctx: StepCtx) {
  return all<{ question: string; answer: string }>(
    `SELECT question, answer FROM questions WHERE (${Q_SCOPE} OR (user_id = ? AND repo_id IS NULL))
     AND status IN ('answered','auto_answered') AND answer IS NOT NULL ORDER BY answered_at DESC LIMIT 30`,
    ctx.user.id,
    ctx.repo.id,
    ctx.product?.id ?? null,
    ctx.user.id,
  )
}

/** Questions the owner skipped: agents are told not to ask these (or similar) again. */
async function skippedQuestions(ctx: StepCtx) {
  const rows = await all<{ question: string }>(
    `SELECT question FROM questions WHERE ${Q_SCOPE} AND status = 'dismissed' ORDER BY answered_at DESC LIMIT 30`,
    ctx.user.id,
    ctx.repo.id,
    ctx.product?.id ?? null,
  )
  return rows.map((r) => r.question)
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

async function addQuestions(ctx: StepCtx, qs: Array<{ question: string; rationale: string; answer?: string; evidence?: string }>) {
  if (!qs.length) return
  const existing = await all<{ question: string; status: string }>(`SELECT question, status FROM questions WHERE ${Q_SCOPE}`, ctx.user.id, ctx.repo.id, ctx.product?.id ?? null)
  const seen = new Set(existing.map((q) => norm(q.question)))
  const skipped = existing.filter((q) => q.status === 'dismissed').map((q) => q.question)
  let suppressed = 0
  const openCount = (await openQuestions(ctx)).length
  let budget = Math.max(0, 10 - openCount)
  const ops: Array<[string, Array<string | number | null>]> = []
  for (const q of qs) {
    const key = norm(q.question)
    if (!key || seen.has(key)) continue
    // The owner skipped a question like this before: don't ask it again in other words.
    if (!q.answer && similarQuestion(q.question, skipped)) {
      suppressed++
      continue
    }
    if (!q.answer && budget-- <= 0) continue
    seen.add(key)
    ops.push([
      `INSERT INTO questions (id, user_id, repo_id, scan_id, question, rationale, status, answer, answer_source, evidence, created_at, answered_at, product_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid(), ctx.user.id, ctx.repo.id, ctx.scan.id, q.question, q.rationale, q.answer ? 'auto_answered' : 'open', q.answer ?? null, q.answer ? 'ai' : null, q.evidence ?? null, now(), q.answer ? now() : null, ctx.product?.id ?? null],
    ])
  }
  await batch(ops)
  const asked = ops.filter((o) => o[1][6] === 'open').length
  const selfAnswered = ops.length - asked
  if (ops.length) await logEvent(ctx.scan.id, `Raised ${asked} question(s)${selfAnswered ? `, answered ${selfAnswered} itself` : ''}`)
  if (suppressed) await logEvent(ctx.scan.id, `Dropped ${suppressed} question(s) similar to ones you skipped`)
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
  if (ctx.product && !ctx.verdicts) ctx.verdicts = await verdictMemory(ctx.product.id, ctx.repo.id)
  const reused: string[] = []
  for (const f of drafts) {
    const fp = await sha256Hex(`${ctx.repo.id}|${f.category}|${norm(f.title)}|${f.file ?? ''}`)
    if (existing.has(fp)) continue
    existing.add(fp)
    // Product memory: the same claim on byte-identical code keeps its earlier verdict (no re-validation).
    const prior = ctx.verdicts && f.source && ['ai-review', 'heuristic', 'code-scanning'].includes(f.source) ? priorVerdict(ctx.verdicts, { title: f.title, file: f.file ?? null, category: f.category }, f.file ? (ctx.state.hashes?.[f.file] ?? null) : null) : null
    if (prior) reused.push(prior.id)
    const verdict = prior && (prior.verdict === 'rejected' || prior.verdict === 'confirmed') ? prior.verdict : null
    const verification = verdict ? `Product memory: ${verdict} in an earlier scan on identical code.\n${prior!.reasoning}` : null
    ops.push([
      `INSERT INTO findings (id, scan_id, repo_id, user_id, severity, category, title, file, line, description, impact, recommendation, poc, confidence, fingerprint, created_at, trace_json, threat_model, source, skills_json, verdict, verification, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uid(), ctx.scan.id, ctx.repo.id, ctx.user.id, verdict === 'confirmed' ? prior!.severity : f.severity, f.category, f.title, f.file ?? null, f.line ?? null, f.description,
        f.impact ?? null, f.recommendation ?? null, f.poc ?? null, f.confidence ?? 'medium', fp, now(),
        f.trace?.length ? JSON.stringify(f.trace) : null, f.threatModel ?? null, f.source ?? null, f.skills?.length ? JSON.stringify(f.skills) : null,
        verdict, verification, verdict === 'rejected' ? 'dismissed' : 'open',
      ],
    ])
  }
  await batch(ops)
  if (reused.length) {
    ctx.state.memoryVerdicts = (ctx.state.memoryVerdicts ?? 0) + reused.length
    await memoryHit(reused)
    await logEvent(ctx.scan.id, `Product memory: reused ${reused.length} earlier verdict(s) for unchanged code`)
  }
}

/** Records reviewed files (with blob hash) so later scans of the product skip them while unchanged. */
async function rememberBatch(ctx: StepCtx, paths: string[], findings: Array<{ file?: string | null }>) {
  if (!ctx.product || !paths.length) return
  await rememberReviewed(
    ctx.product.id,
    ctx.repo.id,
    ctx.scan.id,
    paths.map((path) => ({ path, hash: ctx.state.hashes?.[path] ?? null, findings: findings.filter((f) => f.file === path).length })),
  )
}

/** Finding sources produced by reviewing a file's content (the work product memory skips). */
const REVIEW_SOURCES = ['ai-review', 'heuristic']

type FindingRow = {
  id: string; scan_id: string; severity: string; category: string; title: string; file: string | null; line: number | null; description: string
  impact: string | null; recommendation: string | null; poc: string | null; confidence: string | null; fingerprint: string; status: string; created_at: number
  trace_json: string | null; threat_model: string | null; source: string | null; skills_json: string | null; verdict: string | null; verification: string | null
  carried_from: string | null
}

/**
 * Product memory skipped `paths` because they were reviewed at their current blob hash, so the
 * scan would otherwise lose what that review found. Copies each still-open finding into this scan
 * (same fingerprint, verdict and evidence). The newest copy of a finding since the reviewing scan
 * decides: one the user (or triage, or the validator) dismissed or marked fixed stays out.
 * Dependency, runtime and code-scanning findings are not carried: those steps rerun every scan.
 */
async function carryFindings(ctx: StepCtx, paths: string[], reviewedBy: Record<string, string | null>): Promise<number> {
  const scans = new Map(
    (
      await all<{ id: string; created_at: number }>(
        `SELECT id, created_at FROM scans WHERE repo_id = ? AND user_id = ? AND kind = 'security' AND id <> ?`,
        ctx.repo.id,
        ctx.user.id,
        ctx.scan.id,
      )
    ).map((r) => [r.id, r.created_at]),
  )
  // Per path: when the scan that reviewed it at this hash ran. Unknown reviewer → nothing to carry.
  const since = new Map<string, number>()
  for (const p of paths) {
    const at = reviewedBy[p] ? scans.get(reviewedBy[p]!) : undefined
    if (at !== undefined) since.set(p, at)
  }
  if (!since.size) return 0
  const rows = await all<FindingRow & { scan_at: number }>(
    `SELECT f.*, s.created_at AS scan_at FROM findings f JOIN scans s ON s.id = f.scan_id
     WHERE f.repo_id = ? AND f.user_id = ? AND s.kind = 'security' AND f.scan_id <> ? AND s.created_at >= ?
       AND f.file IS NOT NULL AND COALESCE(f.source, 'ai-review') IN (${REVIEW_SOURCES.map(() => '?').join(',')})`,
    ctx.repo.id,
    ctx.user.id,
    ctx.scan.id,
    Math.min(...since.values()),
    ...REVIEW_SOURCES,
  )
  const latest = new Map<string, FindingRow & { scan_at: number }>()
  for (const r of rows) {
    const from = since.get(r.file!)
    if (from === undefined || r.scan_at < from) continue
    const seen = latest.get(r.fingerprint)
    if (!seen || r.scan_at > seen.scan_at) latest.set(r.fingerprint, r)
  }
  const existing = new Set(
    (await all<{ fingerprint: string }>('SELECT fingerprint FROM findings WHERE scan_id = ?', ctx.scan.id)).map((f) => f.fingerprint),
  )
  const carry = [...latest.values()].filter((r) => r.status === 'open' && !existing.has(r.fingerprint))
  await batch(
    carry.map((r) => [
      `INSERT INTO findings (id, scan_id, repo_id, user_id, severity, category, title, file, line, description, impact, recommendation, poc, confidence, fingerprint, created_at, trace_json, threat_model, source, skills_json, verdict, verification, status, carried_from)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [
        uid(), ctx.scan.id, ctx.repo.id, ctx.user.id, r.severity, r.category, r.title, r.file, r.line, r.description,
        r.impact, r.recommendation, r.poc, r.confidence, r.fingerprint, r.created_at,
        r.trace_json, r.threat_model, r.source, r.skills_json, r.verdict, r.verification, r.carried_from ?? r.scan_id,
      ],
    ]),
  )
  if (carry.length) await logEvent(ctx.scan.id, `Product memory: carried ${carry.length} open finding(s) over from unchanged files`)
  return carry.length
}

/** Durable facts worth sharing with every agent in the product. */
function profileFacts(repo: string, profile: RepoProfile, notes: string[]) {
  const facts: Array<{ text: string; evidence?: string }> = []
  if (profile.auth && profile.auth !== 'Unknown') facts.push({ text: `${repo} auth: ${profile.auth}` })
  if (profile.deployment && profile.deployment !== 'Unknown') facts.push({ text: `${repo} deployment: ${profile.deployment}` })
  if (profile.dataStores.length && profile.dataStores[0] !== 'Unknown') facts.push({ text: `${repo} data stores: ${profile.dataStores.join(', ')}` })
  if (profile.externalServices.length) facts.push({ text: `${repo} external services: ${profile.externalServices.join(', ')}` })
  for (const n of [...profile.notes, ...notes.filter((x) => x.startsWith('UNENFORCED:'))]) facts.push({ text: `${repo}: ${n}` })
  return facts
}

// ---------------------------------------------------------------- understand

async function understandStep(ctx: StepCtx): Promise<StepResult> {
  const { scan, state } = ctx
  switch (scan.phase) {
    case 'queued':
    case 'init': {
      const paths = await initTree(ctx, 30)
      if (!ctx.llm) await addQuestions(ctx, heuristicQuestions(paths))
      return { phase: scan.engine === 'codex' ? 'codex_recon' : 'read', progress: 10 }
    }
    case 'codex_recon':
    case 'codex_recon_wait':
      return codexReconStep(ctx)
    case 'read': {
      const batchPaths = nextBatch(state)
      if (!batchPaths.length) return { phase: 'profile', progress: 88 }
      const files = trimBatch(await readFiles(ctx, batchPaths))
      state.cursor = (state.cursor ?? 0) + consumed(batchPaths, files)
      state.filesReviewed = (state.filesReviewed ?? 0) + files.length
      if (ctx.llm) {
        const recon = reconPlaybook()
        useSkills(ctx, recon.skills)
        const out = await askJson(ctx.llm, {
          system: `${A.READER_SYSTEM}\n\n${recon.text}`,
          prompt: A.readerPrompt({
            repo: ctx.repo.full_name,
            overview: state.overview ?? '',
            notes: state.notes ?? [],
            openQuestions: await openQuestions(ctx),
            skippedQuestions: await skippedQuestions(ctx),
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
          system: `${A.PROFILE_SYSTEM}\n\n${reconPlaybook().text}`,
          prompt: A.profilePrompt({
            repo: ctx.repo.full_name,
            overview: state.overview ?? '',
            notes: state.notes ?? [],
            openQuestions: await openQuestions(ctx),
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
      if (ctx.product) await rememberFacts(ctx.product.id, ctx.repo.id, scan.id, profileFacts(ctx.repo.full_name, profile, state.notes ?? []))
      const open = (await openQuestions(ctx)).length
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
      return { phase: 'deps', progress: 8 }
    }
    case 'deps': {
      await signalsStep(ctx)
      return { phase: scan.engine === 'codex' ? 'codex_hunt' : 'review', progress: 18 }
    }
    case 'codex_hunt':
    case 'codex_hunt_wait':
      return codexHuntStep(ctx, profile)
    case 'codex_validate':
    case 'codex_validate_wait':
      return codexValidateStep(ctx, profile)
    case 'review': {
      const batchPaths = nextBatch(state)
      if (!batchPaths.length) return ctx.llm ? startValidation(ctx) : { phase: 'triage', progress: 88 }
      const files = trimBatch(await readFiles(ctx, batchPaths))
      state.cursor = (state.cursor ?? 0) + consumed(batchPaths, files)
      state.filesReviewed = (state.filesReviewed ?? 0) + files.length
      const hints = files.flatMap((f) => heuristicFindings(f.path, f.content))
      if (ctx.llm) {
        const playbook = huntPlaybook({ paths: files.map((f) => f.path), differential: Boolean(state.changed?.length) })
        useSkills(ctx, playbook.skills)
        const out = await askJson(ctx.llm, {
          system: A.reviewSystem(prefs, playbook.text),
          prompt: A.reviewPrompt({
            repo: ctx.repo.full_name,
            profile,
            knownAnswers: await knownAnswers(ctx),
            openQuestions: await openQuestions(ctx),
            files: files.map((f) => ({
              path: f.path,
              content: `${hints.filter((h) => h.file === f.path).map((h) => `// static-analyzer hint (verify, may be false positive): ${h.title} @ line ${h.line}`).join('\n')}\n${f.content}`,
            })),
            userContext: prefs.context,
            changed: state.changed,
            skippedQuestions: await skippedQuestions(ctx),
          }),
          schema: A.reviewOutput,
          effort: prefs.depth === 'triage' ? 'low' : 'medium',
        })
        await saveFindings(ctx, out.findings.map((f) => ({ ...f, source: 'ai-review' as const, skills: playbook.skills })))
        await rememberBatch(ctx, files.map((f) => f.path), out.findings)
        await applyAnswers(ctx, out.answers)
        await addQuestions(ctx, out.questions.slice(0, 2))
        await logEvent(scan.id, `Reviewed ${files.map((f) => f.path).join(', ')} → ${out.findings.length} finding(s)`)
      } else {
        for (const h of hints) if (h.skills?.length) useSkills(ctx, h.skills)
        await saveFindings(ctx, hints.map((h) => ({ ...h, source: 'heuristic' as const })))
        await rememberBatch(ctx, files.map((f) => f.path), hints)
        await logEvent(scan.id, `Pattern-scanned ${files.map((f) => f.path).join(', ')} → ${hints.length} finding(s)`)
      }
      const total = state.files?.length || 1
      return { phase: 'review', progress: Math.min(75, 18 + Math.round((57 * (state.cursor ?? 0)) / total)) }
    }
    case 'validate': {
      return validateStep(ctx, profile)
    }
    case 'triage': {
      await triage(ctx, profile)
      return { phase: 'done', progress: 100 }
    }
    default:
      return { phase: 'init', progress: 0 }
  }
}

/**
 * Deterministic signals: OSV advisories, Brotli copies and install scripts (ToB
 * supply-chain-risk-auditor / brotli-checker), runtime version advisories (OpenAI
 * php2shell-checker, Cognition fix data) and GitHub code-scanning alerts (ToB static-analysis).
 */
async function signalsStep(ctx: StepCtx) {
  const { scan, state, prefs } = ctx
  if (prefs.focus.includes('dependencies')) {
    const files = await readFiles(ctx, state.lockfiles ?? [])
    const deps = dedupeDeps(files.flatMap((f) => parseDeps(f.path, f.content)))
    state.depsChecked = deps.length
    const found = await osvFindings(deps).catch(async (e) => {
      await logEvent(scan.id, `OSV lookup failed: ${String(e).slice(0, 200)}`, 'warn')
      return []
    })
    const brotli = brotliFindings(deps)
    const lock = files.find((f) => f.path.endsWith('package-lock.json'))
    const scripts = lock ? installScriptPackages(lock.content) : []
    const supply: FindingDraft[] = scripts.length
      ? [
          {
            severity: 'info',
            category: 'dependency',
            title: `${scripts.length} production dependenc${scripts.length === 1 ? 'y runs' : 'ies run'} install-time scripts`,
            file: lock!.path,
            line: null,
            description: `Packages with install scripts: ${scripts.slice(0, 15).join(', ')}${scripts.length > 15 ? ` and ${scripts.length - 15} more` : ''}.`,
            impact: 'Install scripts execute with the developer/CI user\'s permissions on every install; a compromised version of any of them runs code before the app does.',
            recommendation: 'Check whether `npm ci --ignore-scripts` works for this build; otherwise pin and review these packages.',
            confidence: 'high',
          },
        ]
      : []
    const unparsed = (state.lockfiles ?? []).filter((p) => /(yarn\.lock|pnpm-lock\.yaml)$/.test(p))
    await saveFindings(ctx, [
      ...found.map((f) => ({ ...f, source: 'osv' as const, skills: ['tob-supply-chain-risk-auditor'] })),
      ...brotli.map((f) => ({ ...f, source: 'runtime-advisory' as const, skills: ['tob-brotli-checker'] })),
      ...supply.map((f) => ({ ...f, source: 'supply-chain' as const, skills: ['tob-supply-chain-risk-auditor'] })),
    ])
    useSkills(ctx, ['tob-supply-chain-risk-auditor'])
    if (brotli.length) useSkills(ctx, ['tob-brotli-checker'])
    await logEvent(
      scan.id,
      `Checked ${deps.length} dependencies against OSV.dev: ${found.length} vulnerable package(s)${scripts.length ? `, ${scripts.length} with install scripts` : ''}${unparsed.length ? `; unassessable lockfiles (not parsed): ${unparsed.join(', ')}` : ''}`,
    )
  }

  // Runtime advisories (Node / PHP / GitLab) from Dockerfiles, version files and CI.
  const runtimeFiles = await readFiles(ctx, state.runtimeFiles ?? [])
  const runtime = runtimeFindings(runtimeFiles)
  if (runtime.length) {
    await saveFindings(ctx, runtime.map((f) => ({ ...f, source: 'runtime-advisory' as const, skills: runtimeSkills(f.title) })))
    useSkills(ctx, [...new Set(runtime.flatMap((f) => runtimeSkills(f.title)))])
  }
  await logEvent(scan.id, `Runtime advisories: checked ${runtimeFiles.length} Dockerfile/version/CI file(s) → ${runtime.length} finding(s)`)

  // GitHub code scanning (CodeQL / Semgrep SARIF) when the repo has it.
  const alerts = await fetchCodeScanningAlerts(ctx.repo, await repoToken(ctx.repo)).catch(() => null)
  if (alerts?.length) {
    const sev = (a: (typeof alerts)[number]): Severity => {
      const s = (a.rule.security_severity_level ?? a.rule.severity ?? '').toLowerCase()
      return s === 'critical' ? 'critical' : s === 'high' || s === 'error' ? 'high' : s === 'medium' || s === 'warning' ? 'medium' : 'low'
    }
    await saveFindings(
      ctx,
      alerts.slice(0, 40).map((a) => ({
        severity: sev(a),
        category: 'code' as const,
        title: `${a.tool.name}: ${a.rule.description ?? a.rule.name ?? a.rule.id}`,
        file: a.most_recent_instance.location?.path ?? null,
        line: a.most_recent_instance.location?.start_line ?? null,
        description: `${a.most_recent_instance.message?.text ?? ''}\nAlert: ${a.html_url}`,
        impact: null,
        recommendation: null,
        confidence: 'medium' as const,
        source: 'code-scanning' as const,
        skills: ['tob-static-analysis'],
      })),
    )
    useSkills(ctx, ['tob-static-analysis'])
  }
  await logEvent(scan.id, alerts ? `Imported ${alerts.length} open GitHub code-scanning alert(s)` : 'GitHub code scanning not available for this repository (skipped)')
}

function runtimeSkills(title: string): string[] {
  if (/PHP/.test(title)) return ['openai-php2shell-checker', 'cognition-devin-vuln-fixes']
  if (/Node/.test(title)) return ['tob-brotli-checker', 'cognition-devin-vuln-fixes']
  return ['cognition-devin-vuln-fixes']
}

// ----- Codex Cloud runtime

const CODEX_POLL_SECONDS = 30
const CODEX_TIMEOUT_MS = 45 * 60_000

async function recordCodexTasks(ctx: StepCtx, status: Partial<Record<CP.CodexRole, string>>) {
  for (const [role, st] of Object.entries(status)) {
    const t = ctx.state.codex?.tasks[role as CP.CodexRole]
    if (t && st) t.status = st
  }
  const tasks = Object.entries(ctx.state.codex?.tasks ?? {}).map(([role, t]) => ({ role, id: t!.id, url: taskUrl(t!.id), status: t!.status ?? 'started' }))
  await run('UPDATE scans SET codex_tasks_json = ? WHERE id = ?', JSON.stringify(tasks), ctx.scan.id)
}

/** Switches this scan to the direct engine after a Codex problem. */
async function codexFallback(ctx: StepCtx, reason: string): Promise<StepResult> {
  await logEvent(ctx.scan.id, `Codex Cloud: ${reason.slice(0, 250)} — falling back to direct ChatGPT review`, 'warn')
  ctx.scan.engine = ctx.llm ? 'ai' : 'heuristic'
  await run('UPDATE scans SET engine = ? WHERE id = ?', ctx.scan.engine, ctx.scan.id)
  ctx.state.cursor = 0
  return ctx.scan.kind === 'understand' ? { phase: 'read', progress: 12 } : { phase: 'review', progress: 20 }
}

/**
 * Starts (phase X) or polls (phase X_wait) a Codex Cloud task. Returns the parsed
 * contract output when complete, a StepResult to continue waiting, or a fallback.
 */
async function runCodexTask<R extends CP.CodexRole>(
  ctx: StepCtx,
  role: R,
  build: (memory: CP.TaskMemory) => Promise<{ prompt: string; skills: string[] }>,
  progress: number,
): Promise<{ done: CP.TaskOutput<R> } | { step: StepResult }> {
  const { scan, state } = ctx
  const client = await codexClientFor(ctx.user).catch(() => null)
  if (!client || !state.codex) return { step: await codexFallback(ctx, 'ChatGPT session unavailable') }
  const waitPhase = `codex_${role}_wait`
  try {
    if (scan.phase !== waitPhase) {
      // A token for this task only: lets Codex pull more memory than fits inline, if its
      // environment has internet access with our host allowlisted. Revoked when the task ends.
      const issued = ctx.product
        ? await issueAgentToken({ userId: ctx.user.id, repoId: ctx.repo.id, productId: ctx.product.id, scanId: scan.id, purpose: role, ttlMs: CODEX_TIMEOUT_MS + 5 * 60_000 }).catch(() => null)
        : null
      const { prompt, skills } = await build({ summary: ctx.memory, api: issued?.api ?? null })
      useSkills(ctx, skills)
      const branch = ctx.repo.default_branch || 'main'
      let id: string
      try {
        id = await client.createTask({ environmentId: state.codex.envId, branch, prompt, qaMode: true })
      } catch (e) {
        if (issued) await revokeAgentToken(issued.hash)
        throw e
      }
      if (issued) await attachTask(issued.hash, id)
      state.codex.tasks[role] = { id, startedAt: now(), tokenHash: issued?.hash }
      await recordCodexTasks(ctx, { [role]: 'running' } as Partial<Record<CP.CodexRole, string>>)
      await logEvent(scan.id, `Codex Cloud ${role} task started on ${branch}: ${taskUrl(id)}`)
      return { step: { phase: waitPhase, progress, delay: CODEX_POLL_SECONDS } }
    }
    const task = state.codex.tasks[role]
    if (!task) return { step: await codexFallback(ctx, `lost ${role} task id`) }
    const res = await client.getTask(task.id)
    // Saved with the step: the cron reads it to tell a live Codex task from a stuck scan.
    task.status = res.status
    if (res.status === 'pending' || res.status === 'in_progress' || res.status === 'unknown') {
      if (now() - task.startedAt > CODEX_TIMEOUT_MS) {
        await finishTaskToken(ctx, role, undefined)
        return { step: await codexFallback(ctx, `${role} task timed out`) }
      }
      return { step: { phase: waitPhase, progress: Math.min(progress + 6, progress + Math.round((now() - task.startedAt) / 60_000)), delay: CODEX_POLL_SECONDS } }
    }
    await recordCodexTasks(ctx, { [role]: res.status } as Partial<Record<CP.CodexRole, string>>)
    const out = res.status === 'completed' ? CP.parseTaskOutput(role, res.messages) : null
    await finishTaskToken(ctx, role, out?.memoryApi)
    if (res.status !== 'completed') return { step: await codexFallback(ctx, `${role} task ${res.status}${res.error ? `: ${res.error}` : ''}`) }
    if (!out) return { step: await codexFallback(ctx, `${role} task finished without valid JSON output`) }
    return { done: out }
  } catch (e) {
    return { step: await codexFallback(ctx, String(e)) }
  }
}

/**
 * Revokes the task's memory token and records what it tells us about the environment:
 * any request proves the agent phase reaches openscan; "unreachable" with no request
 * means internet is off or our host is not allowlisted.
 */
async function finishTaskToken(ctx: StepCtx, role: CP.CodexRole, reported: 'used' | 'unreachable' | 'not_needed' | undefined) {
  const hash = ctx.state.codex?.tasks[role]?.tokenHash
  if (!hash) return
  const uses = await revokeAgentToken(hash).catch(() => 0)
  if (uses > 0) {
    await logEvent(ctx.scan.id, `Codex ${role} task made ${uses} product memory API request(s)`)
  } else if (reported === 'unreachable') {
    await setCodexNet(ctx.user.id, ctx.repo.id, 'unreachable')
    await logEvent(ctx.scan.id, `Codex ${role} task could not reach the product memory API (environment internet access is off or openscan is not allowlisted); it used the inline summary`, 'warn')
  }
}

async function codexReconStep(ctx: StepCtx): Promise<StepResult> {
  const r = await runCodexTask(ctx, 'recon', async (memory) => CP.reconPrompt({ repo: ctx.repo.full_name, userContext: ctx.ownerContext, openQuestions: await openQuestions(ctx), skippedQuestions: await skippedQuestions(ctx), memory }), 15)
  if ('step' in r) return r.step
  const { questions, answers, memoryApi: _memoryApi, ...profile } = r.done
  await applyAnswers(ctx, answers)
  await addQuestions(ctx, questions.slice(0, 6))
  await run('UPDATE repositories SET profile_json = ?, understood_at = ?, updated_at = ? WHERE id = ?', JSON.stringify(profile), now(), now(), ctx.repo.id)
  if (ctx.product) await rememberFacts(ctx.product.id, ctx.repo.id, ctx.scan.id, profileFacts(ctx.repo.full_name, profile, []))
  const open = (await openQuestions(ctx)).length
  await run('UPDATE scans SET summary_json = ? WHERE id = ?', JSON.stringify({ profile, filesReviewed: 0, openQuestions: open }), ctx.scan.id)
  await logEvent(ctx.scan.id, `Codex built the repository profile (${profile.stack.join(', ') || 'stack unknown'}); ${open} question(s) still need you`)
  return { phase: 'done', progress: 100 }
}

async function codexHuntStep(ctx: StepCtx, profile: RepoProfile | null): Promise<StepResult> {
  const r = await runCodexTask(
    ctx,
    'hunt',
    async (memory) => {
      const already = await all<{ title: string }>('SELECT title FROM findings WHERE scan_id = ?', ctx.scan.id)
      return CP.huntPrompt({
        repo: ctx.repo.full_name,
        prefs: { ...ctx.prefs, context: ctx.ownerContext },
        memory,
        profile,
        knownAnswers: await knownAnswers(ctx),
        openQuestions: await openQuestions(ctx),
        alreadyFound: already.map((a) => a.title),
        changed: ctx.state.changed,
        priorityFiles: ctx.state.files ?? [],
        skippedQuestions: await skippedQuestions(ctx),
      })
    },
    22,
  )
  if ('step' in r) return r.step
  const pb = huntPlaybook({ differential: Boolean(ctx.state.changed?.length) })
  ctx.state.filesReviewed = r.done.filesExamined
  await saveFindings(ctx, r.done.findings.map((f) => ({ ...f, source: 'ai-review' as const, skills: pb.skills })))
  await rememberBatch(ctx, r.done.reviewedPaths.filter((p) => ctx.state.hashes?.[p]), r.done.findings)
  await applyAnswers(ctx, r.done.answers)
  await addQuestions(ctx, r.done.questions.slice(0, 3))
  await logEvent(ctx.scan.id, `Codex hunt examined ${r.done.filesExamined} file(s) → ${r.done.findings.length} finding(s)`)
  const next = await startValidation(ctx)
  return next.phase === 'validate' ? { phase: 'codex_validate', progress: 76 } : next
}

async function codexValidateStep(ctx: StepCtx, profile: RepoProfile | null): Promise<StepResult> {
  const ids = ctx.state.validateQueue ?? []
  if (!ids.length) return { phase: 'triage', progress: 88 }
  const rows = (
    await Promise.all(
      ids.map((id) =>
        first<{ id: string; severity: string; title: string; file: string | null; line: number | null; description: string; threat_model: string | null; trace_json: string | null }>(
          'SELECT id, severity, title, file, line, description, threat_model, trace_json FROM findings WHERE id = ?',
          id,
        ),
      ),
    )
  ).filter(Boolean) as Array<{ id: string; severity: string; title: string; file: string | null; line: number | null; description: string; threat_model: string | null; trace_json: string | null }>
  const r = await runCodexTask(
    ctx,
    'validate',
    async (memory) =>
      CP.validatePrompt({
        repo: ctx.repo.full_name,
        prefs: { ...ctx.prefs, context: ctx.ownerContext },
        memory,
        profile,
        knownAnswers: await knownAnswers(ctx),
        findings: rows.map((f, index) => ({ index, severity: f.severity, title: f.title, file: f.file, line: f.line, description: f.description, threatModel: f.threat_model, trace: parseJson<string[]>(f.trace_json, []) })),
      }),
    78,
  )
  if ('step' in r) {
    // Fallback from validation keeps the findings and validates them directly instead.
    return r.step.phase === 'review' ? { phase: 'validate', progress: 78 } : r.step
  }
  for (const v of r.done.verdicts) {
    const f = rows[v.index]
    if (f) await applyVerdict(ctx, f, v)
  }
  ctx.state.validateQueue = []
  return { phase: 'triage', progress: 88 }
}

// ----- independent validation (ToB fp-check + brocards, Cloudflare fresh verifier)

const VALIDATE_PER_STEP = 2

async function startValidation(ctx: StepCtx): Promise<StepResult> {
  const cap = ctx.prefs.depth === 'triage' ? 4 : ctx.prefs.depth === 'deep_poc' ? 12 : 8
  const rows = await all<{ id: string }>(
    `SELECT id FROM findings WHERE scan_id = ? AND status = 'open' AND verdict IS NULL AND carried_from IS NULL
       AND severity IN ('critical','high','medium') AND COALESCE(source, 'ai-review') IN ('ai-review','heuristic','code-scanning')
     ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, created_at LIMIT ?`,
    ctx.scan.id,
    cap,
  )
  ctx.state.validateQueue = rows.map((r) => r.id)
  ctx.state.validateTotal = rows.length
  if (!rows.length) return { phase: 'triage', progress: 88 }
  const pb = validatePlaybook()
  useSkills(ctx, pb.skills)
  await logEvent(ctx.scan.id, `Validating ${rows.length} finding(s) with an independent verifier (fp-check gates, triage brocards)`)
  return { phase: 'validate', progress: 76 }
}

type Verdict = z.infer<typeof A.validateOutput>

/** Applies an independent validator verdict to a finding (shared by direct + Codex validators). */
async function applyVerdict(ctx: StepCtx, f: { id: string; title: string }, out: Verdict) {
  const id = f.id
  const pb = validatePlaybook()
  const gates = Object.entries(out.gates).map(([k, v]) => `${k}: ${v}`).join(', ')
  const missing = out.decision === 'needs_validation' && out.missingFact.trim() ? `\nMissing fact: ${out.missingFact.trim()}` : ''
  const verification = `${out.restatedClaim}\nGates — ${gates}${out.brocardFailed ? `; fails brocard ${out.brocardFailed}` : ''}.\n${out.reasoning}${missing}`
  const skills = JSON.stringify(pb.skills)
  if (out.decision === 'rejected') {
    await run(`UPDATE findings SET verdict = 'rejected', verification = ?, status = 'dismissed', skills_json = ? WHERE id = ?`, verification, skills, id)
  } else if (out.decision === 'needs_validation') {
    await run(`UPDATE findings SET verdict = 'needs_validation', verification = ?, skills_json = ? WHERE id = ?`, verification, skills, id)
    if (out.missingFact.trim()) {
      await addQuestions(ctx, [{ question: out.missingFact.trim(), rationale: `Decides whether "${f.title}" is a real vulnerability.` }])
    }
  } else {
    await run(
      `UPDATE findings SET verdict = 'confirmed', verification = ?, severity = ?, recommendation = COALESCE(NULLIF(?, ''), recommendation), skills_json = ? WHERE id = ?`,
      verification,
      out.severity,
      out.correctedRecommendation,
      skills,
      id,
    )
  }
  await logEvent(ctx.scan.id, `Validator: "${f.title}" → ${out.decision}${out.decision === 'confirmed' ? ` (${out.severity})` : ''}`)
  if (ctx.product && out.decision !== 'needs_validation') {
    const row = await first<{ fingerprint: string; title: string; file: string | null; category: string; severity: string }>('SELECT fingerprint, title, file, category, severity FROM findings WHERE id = ?', id)
    if (row) await rememberVerdict(ctx.product.id, ctx.repo.id, ctx.scan.id, row, out.decision, verification, row.file ? (ctx.state.hashes?.[row.file] ?? null) : null)
  }
}

async function validateStep(ctx: StepCtx, profile: RepoProfile | null): Promise<StepResult> {
  const queue = ctx.state.validateQueue ?? []
  if (!queue.length || !ctx.llm) return { phase: 'triage', progress: 88 }
  const pb = validatePlaybook()
  for (const id of queue.slice(0, VALIDATE_PER_STEP)) {
    const f = await first<{ id: string; severity: string; category: string; title: string; file: string | null; line: number | null; description: string; threat_model: string | null; trace_json: string | null; impact: string | null; recommendation: string | null }>(
      'SELECT id, severity, category, title, file, line, description, threat_model, trace_json, impact, recommendation FROM findings WHERE id = ?',
      id,
    )
    if (!f) continue
    const trace = parseJson<string[]>(f.trace_json, [])
    const paths = [...new Set([f.file, ...tracePaths(trace)].filter(Boolean) as string[])].slice(0, 3)
    const files = await readFiles(ctx, paths)
    try {
      const out = await askJson(ctx.llm, {
        system: A.validateSystem(pb.text),
        prompt: A.validatePrompt({
          repo: ctx.repo.full_name,
          profile,
          knownAnswers: await knownAnswers(ctx),
          finding: { severity: f.severity, category: f.category, title: f.title, file: f.file, line: f.line, description: f.description, threatModel: f.threat_model, trace, impact: f.impact, recommendation: f.recommendation },
          files,
          userContext: ctx.prefs.context,
        }),
        schema: A.validateOutput,
        effort: ctx.prefs.depth === 'triage' ? 'medium' : 'high',
      })
      await applyVerdict(ctx, f, out)
    } catch (e) {
      await logEvent(ctx.scan.id, `Validator could not assess "${f.title}": ${String(e).slice(0, 150)}`, 'warn')
    }
  }
  ctx.state.validateQueue = queue.slice(VALIDATE_PER_STEP)
  const total = ctx.state.validateTotal || 1
  const done = total - ctx.state.validateQueue.length
  return ctx.state.validateQueue.length ? { phase: 'validate', progress: 76 + Math.round((12 * done) / total) } : { phase: 'triage', progress: 88 }
}

const SEV_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

async function triage(ctx: StepCtx, profile: RepoProfile | null) {
  const { scan, state, prefs } = ctx
  const rows = await all<{ id: string; severity: Severity; category: string; title: string; file: string | null; description: string; confidence: string; recommendation: string | null; verdict: string | null }>(
    `SELECT id, severity, category, title, file, description, confidence, recommendation, verdict FROM findings
     WHERE scan_id = ? AND status = 'open' ORDER BY created_at`,
    scan.id,
  )
  let summary: ScanSummary
  if (ctx.llm && rows.length) {
    const pb = reportPlaybook()
    useSkills(ctx, pb.skills)
    const out = await askJson(ctx.llm, {
      system: A.triageSystem(prefs, pb.text),
      prompt: A.triagePrompt({
        repo: ctx.repo.full_name,
        profile,
        knownAnswers: await knownAnswers(ctx),
        findings: rows.slice(0, 80).map((r, index) => ({ index, ...r })),
      }),
      schema: A.triageOutput,
      effort: prefs.depth === 'deep_poc' ? 'high' : 'medium',
    })
    const ops: Array<[string, Array<string | number | null>]> = []
    for (const r of out.ranking) {
      const row = rows[r.index]
      if (!row) continue
      // A finding the independent validator confirmed is never dismissed by triage alone.
      const dismiss = r.falsePositive && row.verdict !== 'confirmed'
      ops.push([
        `UPDATE findings SET priority = ?, severity = ?, status = ? WHERE id = ?`,
        [r.priority, row.verdict === 'confirmed' ? row.severity : r.severity, dismiss ? 'dismissed' : 'open', row.id],
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
      engineNote: 'Heuristic mode: link ChatGPT for AI-verified findings, independent validation (fp-check) and research.',
    }
  }
  const counts = await all<{ severity: Severity; n: number }>(
    `SELECT severity, COUNT(*) AS n FROM findings WHERE scan_id = ? AND status = 'open' GROUP BY severity`,
    scan.id,
  )
  for (const c of counts) summary.stats[c.severity] = c.n
  const verdicts = await all<{ verdict: string | null; n: number }>('SELECT verdict, COUNT(*) AS n FROM findings WHERE scan_id = ? GROUP BY verdict', scan.id)
  summary.validation = { confirmed: 0, needs_validation: 0, rejected: 0, unverified: 0 }
  for (const v of verdicts) {
    const key = (v.verdict ?? 'unverified') as keyof NonNullable<ScanSummary['validation']>
    if (key in summary.validation) summary.validation[key] += v.n
  }
  const nv = await all<{ title: string; verification: string | null }>(
    `SELECT title, verification FROM findings WHERE scan_id = ? AND verdict = 'needs_validation' AND status = 'open' LIMIT 10`,
    scan.id,
  )
  summary.needsValidation = nv.map((r) => ({ title: r.title, missingFact: /^Missing fact: (.+)$/m.exec(r.verification ?? '')?.[1] ?? '' }))
  summary.filesReviewed = state.filesReviewed ?? 0
  summary.dependenciesChecked = state.depsChecked ?? 0
  summary.memory = { skippedFiles: state.memorySkipped?.length ?? 0, reusedVerdicts: state.memoryVerdicts ?? 0, carriedFindings: state.memoryCarried ?? 0 }
  await run('UPDATE scans SET summary_json = ?, skills_json = ? WHERE id = ?', JSON.stringify(summary), JSON.stringify(state.skills ?? []), scan.id)
}

function emptyStats(): Record<Severity, number> {
  return Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>
}

// ---------------------------------------------------------------- scheduling

const INTERVAL: Record<string, number> = { daily: 86_400_000, weekly: 7 * 86_400_000, monthly: 30 * 86_400_000 }

/** Codex task statuses that mean it is still queued or running at Codex (`running`: started, not polled yet). */
const CODEX_LIVE = ['running', 'pending', 'in_progress']

/**
 * The scan is polling a Codex task that, as of its last poll, is still queued or running and
 * within the Codex timeout. Its polls stopping is our problem, not the task's, so reviving it is
 * not a retry. A task in an unknown state, finished, or past the timeout counts as stuck.
 */
export function waitingOnLiveCodexTask(scan: Pick<ScanRow, 'engine' | 'phase' | 'state_json'>, at: number): boolean {
  const role = /^codex_(\w+)_wait$/.exec(scan.phase)?.[1] as CP.CodexRole | undefined
  if (scan.engine !== 'codex' || !role) return false
  const task = parseJson<ScanState>(scan.state_json, {}).codex?.tasks[role]
  return Boolean(task && CODEX_LIVE.includes(task.status ?? '') && at - task.startedAt < CODEX_TIMEOUT_MS)
}

/**
 * Cron: re-enqueue scans that made no progress for STALL_MS and hold no live lease (the worker
 * died, or the next step's message was lost). Each revival uses an attempt, like a failed step,
 * and the scan fails after MAX_ATTEMPTS, so a step that kills its worker can't loop forever.
 * Exception: a scan waiting on a live Codex task is re-enqueued without using an attempt.
 */
export async function reviveStalledScans(at = now()): Promise<void> {
  const stalled = await all<{ id: string }>(STALLED_SCANS_SQL, at - STALL_MS, at)
  for (const { id } of stalled) {
    const leaseId = uid()
    if (!(await acquireLease(exec, id, leaseId, at))) continue // picked up meanwhile
    let requeue = false
    try {
      const scan = await first<ScanRow>('SELECT * FROM scans WHERE id = ?', id)
      if (!scan) continue // nothing to requeue
      const idle = Math.round((at - scan.updated_at) / 60_000)
      const attempts = scan.attempts + 1
      if (waitingOnLiveCodexTask(scan, at)) {
        await exec('UPDATE scans SET updated_at = ? WHERE id = ? AND lease_id = ?', at, id, leaseId)
        await logEvent(id, `No progress for ${idle} min while the Codex task is still running; resuming polling`, 'warn')
        requeue = true
      } else if (attempts >= MAX_ATTEMPTS) {
        await fail(scan, leaseId, `Step "${scan.phase}" made no progress for ${idle} min, ${attempts} times in a row`)
      } else {
        await exec('UPDATE scans SET attempts = ?, updated_at = ? WHERE id = ? AND lease_id = ?', attempts, at, id, leaseId)
        await logEvent(id, `Step "${scan.phase}" made no progress for ${idle} min (attempt ${attempts}/${MAX_ATTEMPTS}); retrying`, 'warn')
        requeue = true
      }
    } finally {
      await releaseLease(exec, id, leaseId)
    }
    if (requeue) await enqueue(id)
  }
}

/** Cron: start recurring reports per user preference + revive stalled scans. */
export async function scheduledTick(): Promise<void> {
  await reviveStalledScans()

  const users = await all<{ id: string; json: string }>(
    `SELECT u.id, p.json FROM users u JOIN preferences p ON p.user_id = u.id WHERE u.onboarded_at IS NOT NULL`,
  )
  for (const u of users) {
    const prefs = preferencesSchema.safeParse(parseJson(u.json, {}))
    const freq = prefs.success ? prefs.data.frequency : 'manual'
    const interval = INTERVAL[freq]
    if (!interval) continue
    // Recurring reports are per product: one product scan covers every member repo.
    const products = await all<{ id: string; last: number | null }>(
      `SELECT p.id, (SELECT MAX(ps.created_at) FROM product_scans ps WHERE ps.product_id = p.id AND ps.kind = 'security' AND ps.trigger <> 'push') AS last
       FROM products p WHERE p.user_id = ?`,
      u.id,
    )
    for (const p of products) {
      if (!p.last || p.last < now() - interval) await startProductScan(u.id, p.id, 'schedule')
    }
  }
}
