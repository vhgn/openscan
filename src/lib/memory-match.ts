/** Pure helpers for product memory matching (unit-tested). */

const STOP = new Set(['a', 'an', 'the', 'in', 'of', 'to', 'and', 'or', 'is', 'are', 'via', 'with', 'for', 'on', 'by', 'from', 'can', 'be', 'without'])

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

const Q_STOP = new Set(
  'a an the is are was were be been do does did any this that these those it its of to in on for from with by as at or and not no what which who whom how when where why will would should can could there their they them you your app application project repo repository code service'.split(' '),
)

function questionTerms(q: string): Set<string> {
  return new Set(
    q
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !Q_STOP.has(w))
      .map((w) => (w.length > 5 ? w.replace(/(ly|ing|ed|es|s)$/, '') : w)),
  )
}

/**
 * True when `q` asks essentially the same thing as one of `others` (word overlap
 * of the shorter question's key terms). Used to stop re-asking skipped questions
 * in different words. Pure.
 */
export function similarQuestion(q: string, others: string[]): boolean {
  const a = questionTerms(q)
  if (!a.size) return false
  return others.some((o) => {
    const b = questionTerms(o)
    if (!b.size) return false
    let shared = 0
    for (const w of a) if (b.has(w)) shared++
    const small = Math.min(a.size, b.size)
    return small >= 2 ? shared / small >= 0.7 : shared === small && a.size === b.size
  })
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
