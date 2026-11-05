/**
 * Dependency extraction + OSV.dev lookups (free, no API key).
 * https://google.github.io/osv.dev/post-v1-querybatch/
 */
import type { FindingDraft, Severity } from '../types'

export interface Dep {
  ecosystem: 'npm' | 'PyPI' | 'Go' | 'crates.io' | 'RubyGems'
  name: string
  version: string
  file: string
}

export function parseDeps(path: string, content: string): Dep[] {
  const file = path
  const out: Dep[] = []
  try {
    if (path.endsWith('package-lock.json')) {
      const j = JSON.parse(content) as { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> }
      if (j.packages) {
        for (const [k, v] of Object.entries(j.packages)) {
          if (!k || !v.version) continue
          const name = k.slice(k.lastIndexOf('node_modules/') + 'node_modules/'.length)
          out.push({ ecosystem: 'npm', name, version: v.version, file })
        }
      } else if (j.dependencies) {
        for (const [name, v] of Object.entries(j.dependencies)) if (v.version) out.push({ ecosystem: 'npm', name, version: v.version, file })
      }
    } else if (path.endsWith('package.json')) {
      const j = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      for (const [name, range] of Object.entries({ ...j.dependencies })) {
        const m = /^[\^~=v]?(\d+\.\d+\.\d+[\w.-]*)$/.exec(range.trim())
        if (m) out.push({ ecosystem: 'npm', name, version: m[1], file })
      }
    } else if (/requirements[\w-]*\.txt$/.test(path)) {
      for (const line of content.split('\n')) {
        const m = /^\s*([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\s*==\s*([\w.\-]+)/.exec(line)
        if (m) out.push({ ecosystem: 'PyPI', name: m[1], version: m[2], file })
      }
    } else if (path.endsWith('poetry.lock')) {
      const re = /\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"\s*\nversion\s*=\s*"([^"]+)"/g
      for (const m of content.matchAll(re)) out.push({ ecosystem: 'PyPI', name: m[1], version: m[2], file })
    } else if (path.endsWith('go.mod')) {
      for (const m of content.matchAll(/^\s*(?:require\s+)?([\w.\-]+\.[\w.\-/]+)\s+(v[\w.\-+]+)/gm)) {
        out.push({ ecosystem: 'Go', name: m[1], version: m[2], file })
      }
    } else if (path.endsWith('Cargo.lock')) {
      const re = /\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"\s*\nversion\s*=\s*"([^"]+)"/g
      for (const m of content.matchAll(re)) out.push({ ecosystem: 'crates.io', name: m[1], version: m[2], file })
    } else if (path.endsWith('Gemfile.lock')) {
      for (const m of content.matchAll(/^ {4}([a-zA-Z0-9_\-]+) \(([\d.]+)\)$/gm)) out.push({ ecosystem: 'RubyGems', name: m[1], version: m[2], file })
    }
  } catch {
    // unparsable manifest: ignore
  }
  return out
}

export function dedupeDeps(deps: Dep[], max = 400): Dep[] {
  const seen = new Set<string>()
  const out: Dep[] = []
  for (const d of deps) {
    const k = `${d.ecosystem}:${d.name}@${d.version}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(d)
    if (out.length >= max) break
  }
  return out
}

interface OsvVuln {
  id: string
  summary?: string
  details?: string
  aliases?: string[]
  severity?: Array<{ type: string; score: string }>
  database_specific?: { severity?: string }
  affected?: Array<{ ranges?: Array<{ events?: Array<{ fixed?: string }> }> }>
}

function osvSeverity(v: OsvVuln): Severity {
  const s = v.database_specific?.severity?.toLowerCase()
  if (s === 'critical') return 'critical'
  if (s === 'high') return 'high'
  if (s === 'moderate' || s === 'medium') return 'medium'
  if (s === 'low') return 'low'
  const cvss = v.severity?.find((x) => x.type.startsWith('CVSS'))?.score ?? ''
  const m = /^(\d+(\.\d+)?)$/.exec(cvss)
  if (m) {
    const n = Number(m[1])
    return n >= 9 ? 'critical' : n >= 7 ? 'high' : n >= 4 ? 'medium' : 'low'
  }
  return 'medium'
}

function fixedVersions(v: OsvVuln): string[] {
  const out = new Set<string>()
  for (const a of v.affected ?? []) for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) out.add(e.fixed)
  return [...out]
}

const SEV_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

/** Query OSV for known vulnerabilities; returns one finding per vulnerable package. */
export async function osvFindings(deps: Dep[]): Promise<FindingDraft[]> {
  if (!deps.length) return []
  const res = await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ queries: deps.map((d) => ({ package: { ecosystem: d.ecosystem, name: d.name }, version: d.version })) }),
  })
  if (!res.ok) throw new Error(`OSV querybatch failed: ${res.status}`)
  const data = (await res.json()) as { results: Array<{ vulns?: Array<{ id: string }> }> }
  const hits = deps.map((d, i) => ({ dep: d, ids: (data.results[i]?.vulns ?? []).map((v) => v.id) })).filter((h) => h.ids.length)

  const details = new Map<string, OsvVuln>()
  const allIds = [...new Set(hits.flatMap((h) => h.ids))].slice(0, 60)
  await Promise.all(
    allIds.map(async (id) => {
      const r = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`)
      if (r.ok) details.set(id, (await r.json()) as OsvVuln)
    }),
  )

  return hits.map(({ dep, ids }) => {
    const vulns = ids.map((id) => details.get(id) ?? ({ id } as OsvVuln))
    const worst = vulns.reduce<Severity>((acc, v) => (SEV_RANK[osvSeverity(v)] > SEV_RANK[acc] ? osvSeverity(v) : acc), 'low')
    const fixes = [...new Set(vulns.flatMap(fixedVersions))]
    const names = vulns.map((v) => [v.id, ...(v.aliases ?? []).filter((a) => a.startsWith('CVE-'))].join('/')).slice(0, 5)
    return {
      severity: worst,
      category: 'dependency' as const,
      title: `${dep.name}@${dep.version} has ${ids.length} known vulnerabilit${ids.length === 1 ? 'y' : 'ies'}`,
      file: dep.file,
      line: null,
      description: vulns
        .slice(0, 4)
        .map((v) => `• ${v.id}: ${v.summary ?? (v.details ?? '').slice(0, 160)}`)
        .join('\n'),
      impact: `Advisories: ${names.join(', ')}${ids.length > 5 ? ` and ${ids.length - 5} more` : ''}. Exploitability depends on whether the vulnerable code path is reachable from your app.`,
      recommendation: fixes.length ? `Upgrade ${dep.name} to a fixed version (${fixes.slice(0, 3).join(', ')} or later).` : `No fixed version published yet; assess reachability and consider an alternative package.`,
      confidence: 'high' as const,
    }
  })
}
