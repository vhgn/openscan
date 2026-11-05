/**
 * Products (groups of repositories) and their unified memory.
 * Memory lets every agent in a product reuse what earlier scans established:
 * reviewed files (by git blob hash), validator verdicts, and durable facts.
 */
import { all, batch, first, now, parseJson, run, uid } from './db'
import { factKey, reviewTtlDays } from './memory-match'
import type { VerdictMemory } from './memory-match'
export { priorVerdict } from './memory-match'
export type { VerdictMemory }
import type { Preferences } from './types'

export interface ProductRow {
  id: string
  user_id: string
  name: string
  description: string | null
  created_at: number
  updated_at: number
}

export interface MemoryRow {
  id: string
  product_id: string
  repo_id: number | null
  kind: 'fact' | 'reviewed' | 'verdict'
  key: string
  content: string
  evidence: string | null
  content_hash: string | null
  meta_json: string | null
  source_scan_id: string | null
  hits: number
  created_at: number
  updated_at: number
}

// ---------------------------------------------------------------- products

export function listProducts(userId: string) {
  return all<ProductRow & { repos: number }>(
    `SELECT p.*, (SELECT COUNT(*) FROM product_repositories pr WHERE pr.product_id = p.id) AS repos
     FROM products p WHERE p.user_id = ? ORDER BY p.created_at`,
    userId,
  )
}

export function getProduct(userId: string, productId: string) {
  return first<ProductRow>('SELECT * FROM products WHERE id = ? AND user_id = ?', productId, userId)
}

export async function productForRepo(userId: string, repoId: number): Promise<ProductRow | null> {
  return first<ProductRow>(
    `SELECT p.* FROM products p JOIN product_repositories pr ON pr.product_id = p.id WHERE p.user_id = ? AND pr.repo_id = ? LIMIT 1`,
    userId,
    repoId,
  )
}

export function productRepoIds(productId: string) {
  return all<{ repo_id: number }>('SELECT repo_id FROM product_repositories WHERE product_id = ?', productId).then((r) => r.map((x) => x.repo_id))
}

/** Creates or updates a product and makes it the only product owning these repos for this user. */
export async function saveProduct(userId: string, input: { id?: string; name: string; description?: string | null; repoIds: number[] }): Promise<string> {
  const id = input.id ?? uid()
  const ops: Array<[string, Array<string | number | null>]> = []
  if (input.id) {
    ops.push(['UPDATE products SET name = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?', [input.name, input.description ?? null, now(), id, userId]])
  } else {
    ops.push(['INSERT INTO products (id, user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, userId, input.name, input.description ?? null, now(), now()]])
  }
  ops.push(['DELETE FROM product_repositories WHERE product_id = ?', [id]])
  for (const repoId of input.repoIds) {
    // One product per repo per user: detach from the user's other products first.
    ops.push([
      'DELETE FROM product_repositories WHERE repo_id = ? AND product_id IN (SELECT id FROM products WHERE user_id = ? AND id <> ?)',
      [repoId, userId, id],
    ])
    ops.push(['INSERT OR IGNORE INTO product_repositories (product_id, repo_id) VALUES (?, ?)', [id, repoId]])
  }
  await batch(ops)
  // Questions follow their repo into the product so answers are shared.
  if (input.repoIds.length) {
    await run(
      `UPDATE questions SET product_id = ? WHERE user_id = ? AND repo_id IN (${input.repoIds.map(() => '?').join(',')})`,
      id,
      userId,
      ...input.repoIds,
    )
  }
  return id
}

export async function deleteProduct(userId: string, productId: string) {
  await run('DELETE FROM products WHERE id = ? AND user_id = ?', productId, userId)
}

/** Ensures every selected repo belongs to some product (onboarding default product). */
export async function ensureDefaultProduct(userId: string, name: string, repoIds: number[]): Promise<string> {
  const existing = await first<{ id: string }>('SELECT id FROM products WHERE user_id = ? ORDER BY created_at LIMIT 1', userId)
  if (!existing) return saveProduct(userId, { name, repoIds })
  const current = await productRepoIds(existing.id)
  const orphan = []
  for (const r of repoIds) if (!(await productForRepo(userId, r))) orphan.push(r)
  await saveProduct(userId, { id: existing.id, name, repoIds: [...new Set([...current, ...orphan])] })
  return existing.id
}

// ---------------------------------------------------------------- memory: writes

async function upsertMemory(m: Omit<MemoryRow, 'id' | 'hits' | 'created_at' | 'updated_at'>) {
  await run(
    `INSERT INTO memory (id, product_id, repo_id, kind, key, content, evidence, content_hash, meta_json, source_scan_id, hits, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(product_id, kind, key) DO UPDATE SET content = excluded.content, evidence = excluded.evidence,
       content_hash = excluded.content_hash, meta_json = excluded.meta_json, source_scan_id = excluded.source_scan_id,
       repo_id = excluded.repo_id, updated_at = excluded.updated_at`,
    uid(), m.product_id, m.repo_id, m.kind, m.key, m.content, m.evidence, m.content_hash, m.meta_json, m.source_scan_id, now(), now(),
  )
}

export async function rememberFacts(productId: string, repoId: number | null, scanId: string | null, facts: Array<{ text: string; evidence?: string | null }>) {
  for (const f of facts.slice(0, 40)) {
    const text = f.text.trim()
    if (text.length < 8) continue
    await upsertMemory({ product_id: productId, repo_id: repoId, kind: 'fact', key: factKey(text), content: text, evidence: f.evidence ?? null, content_hash: null, meta_json: null, source_scan_id: scanId })
  }
}

export async function rememberReviewed(productId: string, repoId: number, scanId: string, files: Array<{ path: string; hash: string | null; findings: number }>) {
  const ops: Array<[string, Array<string | number | null>]> = files
    .filter((f) => f.hash)
    .map((f) => [
      `INSERT INTO memory (id, product_id, repo_id, kind, key, content, evidence, content_hash, meta_json, source_scan_id, hits, created_at, updated_at)
       VALUES (?, ?, ?, 'reviewed', ?, ?, NULL, ?, NULL, ?, 0, ?, ?)
       ON CONFLICT(product_id, kind, key) DO UPDATE SET content = excluded.content, content_hash = excluded.content_hash,
         source_scan_id = excluded.source_scan_id, updated_at = excluded.updated_at`,
      [uid(), productId, repoId, `${repoId}:${f.path}`, f.findings ? `${f.findings} finding(s)` : 'no findings', f.hash, scanId, now(), now()],
    ])
  await batch(ops)
}

export async function rememberVerdict(
  productId: string,
  repoId: number,
  scanId: string,
  f: { fingerprint: string; title: string; file: string | null; category: string; severity: string },
  verdict: string,
  reasoning: string,
  fileHash: string | null,
) {
  await upsertMemory({
    product_id: productId,
    repo_id: repoId,
    kind: 'verdict',
    key: f.fingerprint,
    content: `${verdict}: ${f.title}`,
    evidence: reasoning.slice(0, 2000),
    content_hash: fileHash,
    meta_json: JSON.stringify({ verdict, title: f.title, file: f.file, category: f.category, severity: f.severity }),
    source_scan_id: scanId,
  })
}

export async function memoryHit(ids: string[]) {
  await batch(ids.map((id) => ['UPDATE memory SET hits = hits + 1 WHERE id = ?', [id]]))
}

export async function forgetMemory(productId: string, memoryId?: string, kind?: string) {
  if (memoryId) await run('DELETE FROM memory WHERE id = ? AND product_id = ?', memoryId, productId)
  else if (kind) await run('DELETE FROM memory WHERE product_id = ? AND kind = ?', productId, kind)
  else await run('DELETE FROM memory WHERE product_id = ?', productId)
}

// ---------------------------------------------------------------- memory: reads

/** Paths reviewed at exactly this blob hash recently → safe to skip. */
export async function unchangedReviewed(productId: string, repoId: number, hashes: Record<string, string>, prefs: Pick<Preferences, 'depth'>) {
  const rows = await all<MemoryRow>(
    `SELECT * FROM memory WHERE product_id = ? AND repo_id = ? AND kind = 'reviewed' AND updated_at > ?`,
    productId,
    repoId,
    now() - reviewTtlDays(prefs.depth) * 86_400_000,
  )
  const hit = rows.filter((r) => {
    const path = r.key.slice(r.key.indexOf(':') + 1)
    return r.content_hash && hashes[path] === r.content_hash
  })
  return { paths: new Set(hit.map((r) => r.key.slice(r.key.indexOf(':') + 1))), ids: hit.map((r) => r.id), outcomes: Object.fromEntries(hit.map((r) => [r.key.slice(r.key.indexOf(':') + 1), r.content])) }
}


export async function verdictMemory(productId: string, repoId: number): Promise<VerdictMemory[]> {
  const rows = await all<MemoryRow>(`SELECT * FROM memory WHERE product_id = ? AND repo_id = ? AND kind = 'verdict' ORDER BY updated_at DESC LIMIT 200`, productId, repoId)
  return rows.map((r) => {
    const m = parseJson<{ verdict: string; title: string; file: string | null; category: string; severity: string }>(r.meta_json, { verdict: '', title: '', file: null, category: '', severity: 'medium' })
    return { id: r.id, ...m, reasoning: r.evidence ?? '', hash: r.content_hash }
  })
}

/** Text block injected into agent prompts. */
export async function memoryContext(productId: string, repoId: number, opts: { skipPaths?: string[] } = {}): Promise<string> {
  const product = await first<{ name: string }>('SELECT name FROM products WHERE id = ?', productId)
  const facts = await all<MemoryRow>(`SELECT * FROM memory WHERE product_id = ? AND kind = 'fact' ORDER BY (repo_id IS NULL) DESC, hits DESC, updated_at DESC LIMIT 30`, productId)
  const siblings = await all<{ full_name: string; profile_json: string | null }>(
    `SELECT r.full_name, r.profile_json FROM product_repositories pr JOIN repositories r ON r.id = pr.repo_id WHERE pr.product_id = ? AND r.id <> ?`,
    productId,
    repoId,
  )
  const verdicts = await verdictMemory(productId, repoId)
  const rejected = verdicts.filter((v) => v.verdict === 'rejected').slice(0, 15)
  const confirmed = verdicts.filter((v) => v.verdict === 'confirmed').slice(0, 15)
  const lines: string[] = [`PRODUCT MEMORY (product "${product?.name ?? ''}", shared by every repository and every past scan):`]
  if (siblings.length) {
    lines.push('Other repositories in this product (consider cross-repo trust boundaries):')
    for (const s of siblings) {
      const p = parseJson<{ summary?: string; auth?: string } | null>(s.profile_json, null)
      lines.push(`- ${s.full_name}: ${p?.summary?.slice(0, 200) ?? '(not profiled yet)'}${p?.auth ? ` | auth: ${p.auth.slice(0, 120)}` : ''}`)
    }
  }
  if (facts.length) {
    lines.push('Established facts (do not re-derive or re-ask):')
    for (const f of facts) lines.push(`- ${f.content}${f.evidence ? ` [${f.evidence.slice(0, 80)}]` : ''}`)
  }
  if (rejected.length) {
    lines.push('Previously REJECTED claims on unchanged code (do not raise again unless the code changed):')
    for (const v of rejected) lines.push(`- ${v.title} (${v.file ?? 'n/a'}): ${v.reasoning.split('\n').pop()?.slice(0, 140) ?? ''}`)
  }
  if (confirmed.length) {
    lines.push('Previously CONFIRMED issues (re-check only whether they are fixed):')
    for (const v of confirmed) lines.push(`- ${v.title} (${v.file ?? 'n/a'})`)
  }
  if (opts.skipPaths?.length) {
    lines.push(`Files already reviewed at their current version (skip unless needed to complete a trace): ${opts.skipPaths.slice(0, 80).join(', ')}`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

export async function memoryStats(productId: string) {
  const rows = await all<{ kind: string; n: number; hits: number }>('SELECT kind, COUNT(*) AS n, SUM(hits) AS hits FROM memory WHERE product_id = ? GROUP BY kind', productId)
  const by = Object.fromEntries(rows.map((r) => [r.kind, r])) as Record<string, { n: number; hits: number }>
  return {
    facts: by.fact?.n ?? 0,
    reviewed: by.reviewed?.n ?? 0,
    verdicts: by.verdict?.n ?? 0,
    saved: (by.reviewed?.hits ?? 0) + (by.verdict?.hits ?? 0),
  }
}

export function listMemory(productId: string, kind?: string) {
  return kind
    ? all<MemoryRow>('SELECT * FROM memory WHERE product_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT 300', productId, kind)
    : all<MemoryRow>('SELECT * FROM memory WHERE product_id = ? ORDER BY kind, updated_at DESC LIMIT 300', productId)
}
