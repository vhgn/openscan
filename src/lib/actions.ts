/** Write actions shared by the UI (server functions) and the REST API. */
import { first, now, run } from './db'
import { productForRepo, rememberFacts } from './products'
import { createScan, productIdForRepo, startProductScan } from './scanner/engine'
import type { ScanKind } from './types'

/**
 * Starts a scan of one linked repository and returns the repository scan id. A security scan
 * runs inside its product (a product scan covering just this repo); a reading stands alone.
 */
export async function startScanFor(userId: string, repoId: number, kind: ScanKind = 'security'): Promise<string | null> {
  const link = await first<{ full_name: string }>(
    'SELECT r.full_name FROM user_repositories ur JOIN repositories r ON r.id = ur.repo_id WHERE ur.user_id = ? AND ur.repo_id = ?',
    userId,
    repoId,
  )
  if (!link) return null
  if (kind === 'understand') return createScan(userId, repoId, 'understand', 'manual')
  const productId = await productIdForRepo(userId, repoId, link.full_name.split('/')[0])
  const started = await startProductScan(userId, productId, 'manual', { repoIds: [repoId] })
  return started?.scanIds[0] ?? null
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
