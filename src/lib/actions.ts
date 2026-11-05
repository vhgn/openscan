/** Write actions shared by the UI (server functions) and the REST API. */
import { first, now, run } from './db'
import { productForRepo, rememberFacts } from './products'
import { createScanOnce, productIdForRepo, startProductScan } from './scanner/engine'
import { resolveScanRepo, type PublicRepoError } from './github/repos'
import type { ScanKind } from './types'

export type StartScanResult = { ok: true; id: string; repo: string; existing: boolean } | { ok: false; error: PublicRepoError | 'not_started'; message: string }

/**
 * Starts a scan of one repository and returns the repository scan id: a linked repository by id,
 * or any public repository by "owner/name" or GitHub URL (linked to the user on the way).
 * A security scan runs inside its product (a product scan covering just this repo); a reading stands alone.
 * When the same kind of scan is already queued or running for the repo, that scan is returned with
 * `existing: true`, so retries and double-clicks never start a second one.
 */
export async function startScanFor(userId: string, ref: number | string, kind: ScanKind = 'security'): Promise<StartScanResult> {
  const r = await resolveScanRepo(userId, ref)
  if (!r.ok) return r
  const { id: repoId, full_name } = r.repo
  if (kind === 'understand') return { ok: true, ...(await createScanOnce(userId, repoId, 'understand', 'manual')), repo: full_name }
  const active = await first<{ id: string }>(
    `SELECT id FROM scans WHERE user_id = ? AND repo_id = ? AND kind = 'security' AND status IN ('queued','running')`,
    userId,
    repoId,
  )
  if (active) return { ok: true, id: active.id, repo: full_name, existing: true }
  const productId = await productIdForRepo(userId, repoId, full_name.split('/')[0])
  const started = await startProductScan(userId, productId, 'manual', { repoIds: [repoId] })
  const id = started?.scanIds[0]
  return id ? { ok: true, id, repo: full_name, existing: false } : { ok: false, error: 'not_started', message: `${full_name} could not be scanned right now.` }
}

/** Records the owner's answer and turns it into product memory every agent sees. Returns false if not found. */
export async function answerQuestionFor(userId: string, questionId: string, answer: string): Promise<boolean> {
  const q = await first<{ question: string; repo_id: number | null; product_id: string | null }>(
    'SELECT question, repo_id, product_id FROM questions WHERE id = ? AND user_id = ?',
    questionId,
    userId,
  )
  if (!q) return false
  await run(
    `UPDATE questions SET status = 'answered', answer = ?, answer_source = 'user', answered_at = ? WHERE id = ? AND user_id = ?`,
    answer,
    now(),
    questionId,
    userId,
  )
  const productId = q.product_id ?? (q.repo_id ? (await productForRepo(userId, q.repo_id))?.id : null)
  if (productId) await rememberFacts(productId, null, null, [{ text: `Owner: ${q.question} → ${answer}`, evidence: 'answered by the owner' }])
  return true
}

export async function setFindingStatus(userId: string, findingId: string, status: 'open' | 'dismissed' | 'fixed'): Promise<boolean> {
  const found = await first('SELECT 1 FROM findings WHERE id = ? AND user_id = ?', findingId, userId)
  if (!found) return false
  await run('UPDATE findings SET status = ? WHERE id = ? AND user_id = ?', status, findingId, userId)
  return true
}
