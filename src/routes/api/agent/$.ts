import { createFileRoute } from '@tanstack/react-router'
import { all, first, parseJson } from '#/lib/db'
import { authenticateAgent, type AgentTokenRow } from '#/lib/codex/agent-tokens'
import { verdictMemory, type MemoryRow } from '#/lib/products'
import { formatFacts, formatIndex, formatRepos, formatReviewed, formatVerdicts } from '#/lib/codex/memory-api'

/**
 * Read-only API for Codex Cloud tasks, authenticated with the task's short-lived token:
 *   GET /api/agent/ping
 *   GET /api/agent/memory[/facts|/verdicts|/reviewed|/repos]
 * Plain text, so `curl` output is directly readable by the agent.
 */
export const Route = createFileRoute('/api/agent/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const tok = await authenticateAgent(request)
        if (!tok) return text('unauthorized: missing, expired or revoked token', 401)
        const view = (params._splat ?? '').replace(/\/+$/, '')
        if (view === 'ping') return text('ok: openscan is reachable from this environment')
        if (!view.startsWith('memory')) return text('not found', 404)
        if (!tok.product_id) return text('this token has no memory access', 403)
        const url = new URL(request.url)
        return text(await memoryView(tok as AgentTokenRow & { product_id: string }, view.slice('memory'.length).replace(/^\//, ''), url))
      },
    },
  },
})

function text(body: string, status = 200) {
  return new Response(body.endsWith('\n') ? body : `${body}\n`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  })
}

async function memoryView(tok: AgentTokenRow & { product_id: string }, view: string, url: URL): Promise<string> {
  const q = url.searchParams.get('q')
  const base = `${url.origin}/api/agent`
  const hashes = await scanHashes(tok.scan_id)
  switch (view) {
    case '': {
      const counts = await first<{ facts: number; verdicts: number; reviewed: number }>(
        `SELECT SUM(kind = 'fact') AS facts, SUM(kind = 'verdict' AND repo_id = ?) AS verdicts, SUM(kind = 'reviewed' AND repo_id = ?) AS reviewed FROM memory WHERE product_id = ?`,
        tok.repo_id,
        tok.repo_id,
        tok.product_id,
      )
      const repos = await first<{ n: number }>('SELECT COUNT(*) AS n FROM product_repositories WHERE product_id = ? AND repo_id <> ?', tok.product_id, tok.repo_id)
      return formatIndex({ facts: counts?.facts ?? 0, verdicts: counts?.verdicts ?? 0, reviewed: counts?.reviewed ?? 0, repos: repos?.n ?? 0 }, base)
    }
    case 'facts': {
      const rows = await all<MemoryRow>(`SELECT * FROM memory WHERE product_id = ? AND kind = 'fact' ORDER BY hits DESC, updated_at DESC LIMIT 300`, tok.product_id)
      return formatFacts(
        rows.map((r) => ({ content: r.content, evidence: r.evidence, repoId: r.repo_id, hits: r.hits })),
        q,
      )
    }
    case 'verdicts': {
      // Only this repository's verdicts: other repos' confirmed, unfixed issues stay out of reach.
      const rows = await verdictMemory(tok.product_id, tok.repo_id)
      const updated = await all<{ id: string; updated_at: number }>(`SELECT id, updated_at FROM memory WHERE product_id = ? AND repo_id = ? AND kind = 'verdict'`, tok.product_id, tok.repo_id)
      const at = new Map(updated.map((u) => [u.id, u.updated_at]))
      return formatVerdicts(
        rows.map((v) => ({ verdict: v.verdict, title: v.title, file: v.file, category: v.category, severity: v.severity, reasoning: v.reasoning, hash: v.hash, updatedAt: at.get(v.id) ?? 0 })),
        hashes,
        { file: url.searchParams.get('file'), q },
      )
    }
    case 'reviewed': {
      const rows = await all<MemoryRow>(`SELECT * FROM memory WHERE product_id = ? AND repo_id = ? AND kind = 'reviewed' ORDER BY updated_at DESC LIMIT 2000`, tok.product_id, tok.repo_id)
      return formatReviewed(
        rows.map((r) => ({ path: r.key.slice(r.key.indexOf(':') + 1), hash: r.content_hash, outcome: r.content, updatedAt: r.updated_at })),
        hashes,
        url.searchParams.get('path'),
      )
    }
    case 'repos': {
      const rows = await all<{ full_name: string; profile_json: string | null }>(
        `SELECT r.full_name, r.profile_json FROM product_repositories pr JOIN repositories r ON r.id = pr.repo_id WHERE pr.product_id = ? AND r.id <> ?`,
        tok.product_id,
        tok.repo_id,
      )
      return formatRepos(rows.map((r) => ({ fullName: r.full_name, profileJson: r.profile_json })))
    }
    default:
      return `unknown view "${view}"; try ${base}/memory`
  }
}

/** Blob hashes recorded by this scan's init step, so the views can say whether code changed. */
async function scanHashes(scanId: string | null): Promise<Record<string, string>> {
  if (!scanId) return {}
  const row = await first<{ state_json: string | null }>('SELECT state_json FROM scans WHERE id = ?', scanId)
  return parseJson<{ hashes?: Record<string, string> }>(row?.state_json, {}).hashes ?? {}
}
