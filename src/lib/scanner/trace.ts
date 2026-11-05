/** File extensions that can appear in a source trace. */
const EXT = 'ts|tsx|js|jsx|mjs|cjs|py|go|rb|php|java|kt|cs|rs|scala|swift|ex|exs|sql|sh|ya?ml|json|toml|tf|html|vue|svelte|c|cc|cpp|h|hpp'

/** Extracts repository paths mentioned in a source trace like "src/a.ts:12 — reads body". Pure (unit-tested). */
export function tracePaths(trace: string[]): string[] {
  const out = new Set<string>()
  const re = new RegExp(`(?:^|[\\s(\`'"])((?:[\\w@.-]+\\/)*[\\w@-][\\w@.-]*\\.(?:${EXT}))(?::\\d+)?(?=$|[\\s)\`'",;:—-])`, 'gi')
  for (const t of trace) {
    for (const m of t.matchAll(re)) {
      const p = m[1].replace(/^\.\//, '')
      if (!/^https?:/i.test(p)) out.add(p)
    }
  }
  return [...out]
}
