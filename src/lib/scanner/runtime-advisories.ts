/**
 * Deterministic runtime/version advisories, re-implemented from:
 *  - Trail of Bits brotli-checker (CVE-2026-111497, Brotli decoder fixed 1.0.10 / 1.1.1 / 1.2.1)
 *  - Cognition fix-node-vuln (Node Oct-2026 release: fixed 22.23.4, 24.22.1, 26.12.1; ≤20 EOL)
 *  - OpenAI php2shell-checker + Cognition fix-php-vuln (CVE-2026-109618/109619: fixed 8.2.35, 8.3.36, 8.4.27, 8.5.12; ≤8.1 no upstream release)
 *  - Cognition fix-gitlab-vuln (CVE-2026-110264: fixed 19.5.1, 19.4.3, 19.3.6, 19.2.9, 19.1.9, 19.0.10, 18.11.13)
 * Version strings are evidence of exposure, not proof: distro/vendor backports can fix
 * an older-looking version, so wording says "potentially" unless the pin is exact.
 * Pure module (unit-tested).
 */
import type { FindingDraft } from '../types'
import type { Dep } from './deps'
import type { TreeEntry } from '../github/repos'

export const RUNTIME_FILE_RE =
  /(^|\/)(Dockerfile[^/]*|[^/]+\.dockerfile|(docker-)?compose[^/]*\.ya?ml|\.nvmrc|\.node-version|\.tool-versions|\.php-version)$|^\.github\/workflows\/[^/]+\.ya?ml$/i

export function selectRuntimeFiles(entries: TreeEntry[], max = 15): string[] {
  return entries
    .filter((e) => RUNTIME_FILE_RE.test(e.path) && !/(^|\/)(node_modules|vendor|test|tests|fixtures?|examples?)\//i.test(e.path))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
    .slice(0, max)
    .map((e) => e.path)
}

type V = [number, number, number]
export function parseVersion(s: string): V | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(s.trim())
  return m ? [Number(m[1]), Number(m[2] ?? -1), Number(m[3] ?? -1)] : null
}
const cmp = (a: V, b: V) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
const fmt = (v: V) => v.filter((n) => n >= 0).join('.')

interface Hit {
  runtime: 'node' | 'php' | 'gitlab'
  raw: string
  file: string
  line: number
}

const lineOf = (content: string, index: number) => content.slice(0, index).split('\n').length

/** Finds runtime version pins in one file. */
export function findRuntimePins(path: string, content: string): Hit[] {
  const hits: Hit[] = []
  const push = (runtime: Hit['runtime'], raw: string, index: number) => hits.push({ runtime, raw: raw.trim(), file: path, line: lineOf(content, index) })
  for (const m of content.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(?:docker\.io\/)?(?:library\/)?(node|php):([\w.\-]+)/gim)) push(m[1].toLowerCase() as 'node' | 'php', m[2], m.index ?? 0)
  for (const m of content.matchAll(/image:\s*['"]?(?:docker\.io\/)?(?:library\/)?(node|php):([\w.\-]+)/gi)) push(m[1].toLowerCase() as 'node' | 'php', m[2], m.index ?? 0)
  for (const m of content.matchAll(/gitlab\/gitlab-(?:ce|ee):([\w.\-]+)/gi)) push('gitlab', m[1], m.index ?? 0)
  if (/(^|\/)\.(nvmrc|node-version)$/.test(path)) {
    const v = content.trim().split('\n')[0] ?? ''
    if (v) push('node', v, 0)
  }
  if (/(^|\/)\.php-version$/.test(path)) push('php', content.trim().split('\n')[0] ?? '', 0)
  if (/(^|\/)\.tool-versions$/.test(path)) {
    for (const m of content.matchAll(/^(nodejs|node|php)\s+([\w.\-]+)/gm)) push(m[1].startsWith('node') ? 'node' : 'php', m[2], m.index ?? 0)
  }
  if (/^\.github\/workflows\//.test(path)) {
    for (const m of content.matchAll(/node-version:\s*\[?\s*['"]?([\w.\-*]+)/g)) push('node', m[1], m.index ?? 0)
    for (const m of content.matchAll(/php-version:\s*\[?\s*['"]?([\w.\-*]+)/g)) push('php', m[1], m.index ?? 0)
  }
  return hits.filter((h) => h.raw && !h.raw.includes('${'))
}

const NODE_FIXED: Record<number, V> = { 22: [22, 23, 4], 24: [24, 22, 1], 26: [26, 12, 1] }
const PHP_FIXED: Record<string, V> = { '8.2': [8, 2, 35], '8.3': [8, 3, 36], '8.4': [8, 4, 27], '8.5': [8, 5, 12] }
const GITLAB_FIXED: Record<string, V> = {
  '19.5': [19, 5, 1], '19.4': [19, 4, 3], '19.3': [19, 3, 6], '19.2': [19, 2, 9], '19.1': [19, 1, 9], '19.0': [19, 0, 10], '18.11': [18, 11, 13],
}

function nodeFinding(h: Hit): FindingDraft | null {
  if (/^(lts|current|latest|node|\*|lts\/\*)/i.test(h.raw)) {
    return floating(h, 'Node.js', 'the October 2026 Node.js security release (22.23.4 / 24.22.1 / 26.12.1, incl. CVE-2026-111497 Brotli RCE)')
  }
  const v = parseVersion(h.raw)
  if (!v) return null
  const [major] = v
  if (major <= 20 || major % 2 === 1) {
    return {
      severity: 'high',
      category: 'config',
      title: `Node.js ${fmt(v)} is end-of-life and receives no security fixes`,
      file: h.file,
      line: h.line,
      description: `${h.file} pins Node.js "${h.raw}". Node ${major} gets no patches for the October 2026 security release (10 CVEs, including CVE-2026-111497, a Brotli decoder out-of-bounds write with RCE impact).`,
      impact: 'Any Brotli-compressed input decoded by the runtime (HTTP clients, zlib usage, proxies) may reach a vulnerable decoder; other fixed TLS/DNS hostname issues also remain.',
      recommendation: `Upgrade to a supported line (22.23.4, 24.22.1 or 26.12.1), keeping the image variant${/-(alpine|slim|bookworm|bullseye)/.test(h.raw) ? ` (${h.raw.replace(/^[\d.]+/, '')})` : ''}. Expect a major-version upgrade review.`,
      confidence: 'high',
    }
  }
  const fixed = NODE_FIXED[major]
  if (!fixed) return null
  if (v[1] < 0 || v[2] < 0) return floating(h, 'Node.js', `Node.js ${fmt(fixed)}`)
  if (cmp(v, fixed) >= 0) return null
  return {
    severity: 'high',
    category: 'config',
    title: `Node.js ${fmt(v)} predates the October 2026 security release (CVE-2026-111497)`,
    file: h.file,
    line: h.line,
    description: `${h.file} pins Node.js ${fmt(v)}; the first fixed release on this line is ${fmt(fixed)}. The release fixes 10 CVEs, four High, including the Brotli decoder out-of-bounds write (CVE-2026-111497).`,
    impact: 'Version-based exposure: a server or client that decodes attacker-supplied Brotli data can be compromised. Vendor images may carry backports; confirm the built image.',
    recommendation: `Bump to ${fmt(fixed)} in the same major and keep the pin style and variant; rebuild with --pull and record the new digest.`,
    confidence: 'high',
  }
}

function phpFinding(h: Hit): FindingDraft | null {
  if (/^(latest|cli|fpm|apache|zts|\*)/i.test(h.raw)) return floating(h, 'PHP', 'PHP 8.2.35 / 8.3.36 / 8.4.27 / 8.5.12 (PHP2Shell)')
  const v = parseVersion(h.raw)
  if (!v) return null
  const minor = `${v[0]}.${Math.max(v[1], 0)}`
  const fixed = PHP_FIXED[minor]
  if (!fixed) {
    if (v[0] > 8 || (v[0] === 8 && v[1] > 5)) return null
    return {
      severity: 'critical',
      category: 'config',
      title: `PHP ${fmt(v)} is potentially vulnerable to PHP2Shell and has no upstream fixed release`,
      file: h.file,
      line: h.line,
      description: `${h.file} pins PHP "${h.raw}". PHP 8.1 and older are affected by CVE-2026-109618/CVE-2026-109619 (unauthenticated RCE, CVSS v4 9.2) and receive only source backports.`,
      impact: 'Every web-serving SAPI (mod_php, FPM, php-cgi, FrankenPHP, LiteSpeed) is at risk. Version strings cannot show distro backports, so this is potential, not confirmed.',
      recommendation: 'Move to a supported branch (8.2.35+, 8.3.36+, 8.4.27+, 8.5.12+), or pin a vendor build whose changelog lists both CVEs.',
      confidence: 'medium',
    }
  }
  if (v[2] < 0) return floating(h, 'PHP', `PHP ${fmt(fixed)}`)
  if (cmp(v, fixed) >= 0) return null
  return {
    severity: 'critical',
    category: 'config',
    title: `PHP ${fmt(v)} is below the PHP2Shell fix (${fmt(fixed)})`,
    file: h.file,
    line: h.line,
    description: `${h.file} pins PHP ${fmt(v)}; CVE-2026-109618/CVE-2026-109619 are fixed in ${fmt(fixed)} on this branch.`,
    impact: 'Potential unauthenticated remote code execution on any web-serving SAPI. Distro packages may carry backports; check the vendor changelog.',
    recommendation: `Bump to ${fmt(fixed)} keeping the image variant (-fpm, -apache, -alpine…), rebuild and verify the built artifact.`,
    confidence: 'high',
  }
}

function gitlabFinding(h: Hit): FindingDraft | null {
  if (/^latest/i.test(h.raw)) return floating(h, 'GitLab', 'GitLab 19.5.1 (CVE-2026-110264)')
  const v = parseVersion(h.raw)
  if (!v) return null
  const fixed = GITLAB_FIXED[`${v[0]}.${v[1]}`]
  const tooOld = !fixed && cmp(v, [18, 11, 0]) < 0
  if (!tooOld && (!fixed || (v[2] >= 0 && cmp(v, fixed) >= 0))) return null
  return {
    severity: 'critical',
    category: 'config',
    title: `Self-managed GitLab ${fmt(v)} is affected by CVE-2026-110264`,
    file: h.file,
    line: h.line,
    description: `${h.file} deploys GitLab "${h.raw}". CVE-2026-110264 (CVSS 10.0, unauthenticated RCE via the Onigmo regex compiler) affects every CE/EE version from 7.0 until the October 2026 patch release.`,
    impact: 'Unauthenticated remote code execution on the GitLab host.',
    recommendation: fixed ? `Upgrade to ${fmt(fixed)} (same minor); for Helm, bump the chart version, not only global.gitlabVersion.` : 'Upgrade to a supported minor with a fix (19.5.1, 19.4.3, 19.3.6, 19.2.9, 19.1.9, 19.0.10 or 18.11.13).',
    confidence: 'high',
  }
}

function floating(h: Hit, runtime: string, target: string): FindingDraft {
  return {
    severity: 'low',
    category: 'config',
    title: `${runtime} uses a floating version ("${h.raw}"); confirm it resolves to a fixed release`,
    file: h.file,
    line: h.line,
    description: `${h.file} references ${runtime} "${h.raw}". Floating tags/versions only pick up ${target} after a fresh pull and rebuild; cached images and CI runners keep older builds.`,
    impact: 'Running builds may still contain the vulnerable version even though the tag looks current.',
    recommendation: 'Rebuild with --pull --no-cache and record the digest, or pin the fixed patch/digest. For actions/setup-node with a floating version, add check-latest: true.',
    confidence: 'low',
  }
}

export function runtimeFindings(files: Array<{ path: string; content: string }>): FindingDraft[] {
  const out: FindingDraft[] = []
  const seen = new Set<string>()
  for (const f of files) {
    for (const h of findRuntimePins(f.path, f.content)) {
      const key = `${h.runtime}:${h.raw}:${h.file}`
      if (seen.has(key)) continue
      seen.add(key)
      const finding = h.runtime === 'node' ? nodeFinding(h) : h.runtime === 'php' ? phpFinding(h) : gitlabFinding(h)
      if (finding) out.push(finding)
    }
  }
  return out
}

/** Brotli decoder copies via package manifests (brotli-checker advisory table). */
export function brotliFindings(deps: Dep[]): FindingDraft[] {
  const vulnerable = (v: V) =>
    (v[0] === 1 && v[1] === 0 && v[2] >= 3 && v[2] <= 9) || (v[0] === 1 && v[1] === 1 && v[2] === 0) || (v[0] === 1 && v[1] === 2 && v[2] === 0)
  return deps
    .filter((d) => d.ecosystem === 'PyPI' && /^brotli$/i.test(d.name))
    .flatMap((d) => {
      const v = parseVersion(d.version)
      if (!v || !vulnerable(v)) return []
      const fixed = v[1] === 0 ? '1.0.10' : v[1] === 1 ? '1.1.1' : '1.2.1'
      return [
        {
          severity: 'high' as const,
          category: 'dependency' as const,
          title: `Brotli ${d.version} bundles a decoder affected by CVE-2026-111497`,
          file: d.file,
          line: null,
          description: `${d.file} resolves Brotli ${d.version}; the decoder out-of-bounds write is fixed in ${fixed}.`,
          impact: 'Decoding attacker-controlled Brotli streams can corrupt memory. Reachability depends on whether untrusted compressed input reaches this decoder.',
          recommendation: `Upgrade Brotli to ${fixed} or later and rebuild any wheels/images that vendor it.`,
          confidence: 'high' as const,
        },
      ]
    })
}

/** Install-time scripts from package-lock (supply-chain-risk-auditor criterion). */
export function installScriptPackages(lockContent: string): string[] {
  try {
    const j = JSON.parse(lockContent) as { packages?: Record<string, { hasInstallScript?: boolean; dev?: boolean }> }
    return Object.entries(j.packages ?? {})
      .filter(([k, v]) => k && v.hasInstallScript && !v.dev)
      .map(([k]) => k.slice(k.lastIndexOf('node_modules/') + 'node_modules/'.length))
  } catch {
    return []
  }
}
