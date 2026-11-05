/** Pure helpers for product memory matching (unit-tested). */

const STOP = new Set(['a', 'an', 'the', 'in', 'of', 'to', 'and', 'or', 'is', 'are', 'via', 'with', 'for', 'on', 'by', 'from', 'can', 'be', 'without', 'mock'])

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  )
}

/** Jaccard similarity of significant words: LLM titles for the same issue vary run to run. */
export function titleSimilarity(a: string, b: string): number {
  const A = titleTokens(a)
  const B = titleTokens(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / (A.size + B.size - inter)
}

export function sameClaim(a: { title: string; file: string | null; category: string }, b: { title: string; file: string | null; category: string }): boolean {
  return a.category === b.category && (a.file ?? '') === (b.file ?? '') && titleSimilarity(a.title, b.title) >= 0.5
}

export function factKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
}

/** Days a reviewed-file memory stays valid, by depth preference. */
export function reviewTtlDays(depth: 'triage' | 'standard' | 'deep_poc'): number {
  return depth === 'deep_poc' ? 14 : 30
}

export interface VerdictMemory {
  id: string
  verdict: string
  title: string
  file: string | null
  category: string
  severity: string
  reasoning: string
  hash: string | null
}

/** A prior verdict for the same claim on byte-identical code (Cloudflare: carry only when source unchanged). */
export function priorVerdict(memory: VerdictMemory[], f: { title: string; file: string | null; category: string }, currentHash: string | null): VerdictMemory | null {
  if (!currentHash) return null
  return memory.find((m) => m.hash === currentHash && sameClaim(m, f)) ?? null
}
