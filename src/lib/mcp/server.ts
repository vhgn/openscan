/**
 * openscan as an MCP server (Streamable HTTP, stateless, JSON responses) at /mcp.
 *
 * Every request carries an OAuth access token issued by src/lib/oauth/server.ts.
 * Tools act as the signed-in user, over the same read models and actions as the UI
 * and REST API. Write tools are only listed when the token has the openscan:write scope.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker'
import { z } from 'zod'
import { all, parseJson } from '../db'
import { appUrl } from '../env'
import { listUserRepos } from '../github/repos'
import { listFindings, listQuestions, listScans, scanDetail } from '../queries'
import { answerQuestionFor, setFindingStatus, startScanFor } from '../actions'
import { SEVERITIES, type RepoProfile } from '../types'
import { authenticateMcp, preflight, withCors, type McpAuth } from '../oauth/server'
import { issuerUrls } from '../oauth/core'

const INSTRUCTIONS = `openscan is an AI security reviewer for the user's GitHub repositories.
Use list_repositories first to see what is linked. list_findings returns the open findings of the latest completed security report per repository, most severe first.
get_scan returns a full report (summary, what matters, next actions, findings, questions). Scans run in the background: after start_scan, poll get_scan until status is completed or failed.
Open questions are things the reviewer could not infer from the code; answering them improves later scans.`

type Content = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }

function ok(data: unknown): Content {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function fail(message: string): Content {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function reportUrl(scanId: string) {
  return `${appUrl()}/scans/${scanId}`
}

async function resolveRepo(userId: string, ref: string) {
  const repos = await listUserRepos(userId)
  const wanted = ref.trim().toLowerCase()
  return repos.find((r) => String(r.id) === wanted || r.full_name.toLowerCase() === wanted) ?? null
}

const SEVERITY_RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i])) as Record<string, number>

function findingView(f: Awaited<ReturnType<typeof listFindings>>[number]) {
  return {
    id: f.id,
    scan_id: f.scan_id,
    repo: f.repo,
    severity: f.severity,
    priority: f.priority,
    category: f.category,
    title: f.title,
    file: f.file,
    line: f.line,
    description: f.description,
    impact: f.impact,
    recommendation: f.recommendation,
    poc: f.poc,
    confidence: f.confidence,
    verdict: f.verdict,
    verification: f.verification,
    status: f.status,
    trace: parseJson<unknown>(f.trace_json, null),
  }
}

const repoArg = z.string().min(1).describe('Repository as "owner/name" or its numeric id from list_repositories')

export function buildMcpServer(auth: McpAuth): McpServer {
  const userId = auth.user.id
  const server = new McpServer(
    { name: 'openscan', title: 'openscan', version: '1.0.0', websiteUrl: appUrl() },
    { instructions: INSTRUCTIONS, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  )
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const

  server.registerTool(
    'list_repositories',
    {
      title: 'List repositories',
      description: 'Repositories linked to openscan, whether each is watched, its product, and its latest security report.',
      annotations: readOnly,
    },
    async () => {
      const repos = await listUserRepos(userId)
      const products = await all<{ repo_id: number; name: string }>(
        `SELECT pr.repo_id, p.name FROM product_repositories pr JOIN products p ON p.id = pr.product_id WHERE p.user_id = ?`,
        userId,
      )
      const latest = new Map<number, Awaited<ReturnType<typeof listScans>>[number]>()
      for (const s of await listScans(userId, 200)) if (s.kind === 'security' && !latest.has(s.repo_id)) latest.set(s.repo_id, s)
      return ok(
        repos.map((r) => {
          const s = latest.get(r.id)
          return {
            id: r.id,
            full_name: r.full_name,
            watched: Boolean(r.selected),
            private: Boolean(r.private),
            language: r.language,
            product: products.find((p) => p.repo_id === r.id)?.name ?? null,
            understood: Boolean(r.understood_at),
            latest_security_scan: s ? { id: s.id, status: s.status, risk: s.risk, headline: s.headline, open_findings: s.findings, created_at: new Date(s.created_at).toISOString() } : null,
          }
        }),
      )
    },
  )

  server.registerTool(
    'get_repository',
    {
      title: 'Get repository profile',
      description: "openscan's understanding of a repository: stack, entry points, data stores, auth, sensitive areas.",
      inputSchema: { repo: repoArg },
      annotations: readOnly,
    },
    async ({ repo }) => {
      const r = await resolveRepo(userId, repo)
      if (!r) return fail(`Repository ${repo} is not linked to openscan.`)
      return ok({
        id: r.id,
        full_name: r.full_name,
        html_url: r.html_url,
        default_branch: r.default_branch,
        watched: Boolean(r.selected),
        profile: parseJson<RepoProfile | null>(r.profile_json, null),
        understood_at: r.understood_at ? new Date(r.understood_at).toISOString() : null,
      })
    },
  )

  server.registerTool(
    'list_scans',
    {
      title: 'List scans',
      description: 'Recent scans (security reports and repository reads), newest first.',
      inputSchema: { repo: repoArg.optional(), limit: z.number().int().min(1).max(100).default(20) },
      annotations: readOnly,
    },
    async ({ repo, limit }) => {
      let scans = await listScans(userId, repo ? 200 : limit)
      if (repo) {
        const r = await resolveRepo(userId, repo)
        if (!r) return fail(`Repository ${repo} is not linked to openscan.`)
        scans = scans.filter((s) => s.repo_id === r.id).slice(0, limit)
      }
      return ok(scans.map((s) => ({ ...s, url: reportUrl(s.id), created_at: new Date(s.created_at).toISOString(), finished_at: s.finished_at ? new Date(s.finished_at).toISOString() : null })))
    },
  )

  server.registerTool(
    'get_scan',
    {
      title: 'Get scan report',
      description: 'Status, progress and, when finished, the full report of one scan: risk, what matters, next actions, findings and questions.',
      inputSchema: {
        scan_id: z.string().min(1),
        include_events: z.boolean().default(false).describe('Include the full activity log (the last 20 events are always included)'),
      },
      annotations: readOnly,
    },
    async ({ scan_id, include_events }) => {
      const d = await scanDetail(userId, scan_id)
      if (!d) return fail(`Scan ${scan_id} was not found.`)
      const { summary_json: _raw, ...scan } = d.scan
      return ok({
        url: reportUrl(scan.id),
        scan,
        profile: d.profile,
        findings: d.findings.map(findingView),
        questions: d.questions.map((q) => ({ id: q.id, question: q.question, rationale: q.rationale, status: q.status, answer: q.answer, answer_source: q.answer_source })),
        codex_tasks: d.codexTasks,
        events: (include_events ? d.events : d.events.slice(-20)).map((e) => ({ at: new Date(e.ts).toISOString(), level: e.level, message: e.message })),
      })
    },
  )

  server.registerTool(
    'list_findings',
    {
      title: 'List open findings',
      description: 'Open findings from the latest completed security report of each repository, most severe first.',
      inputSchema: {
        repo: repoArg.optional(),
        min_severity: z.enum(SEVERITIES).default('info').describe('Only findings at or above this severity'),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: readOnly,
    },
    async ({ repo, min_severity, limit }) => {
      let findings = await listFindings(userId, { limit: 200 })
      if (repo) {
        const r = await resolveRepo(userId, repo)
        if (!r) return fail(`Repository ${repo} is not linked to openscan.`)
        findings = findings.filter((f) => f.repo === r.full_name)
      }
      findings = findings.filter((f) => (SEVERITY_RANK[f.severity] ?? 99) <= SEVERITY_RANK[min_severity]!)
      return ok(findings.slice(0, limit).map(findingView))
    },
  )

  server.registerTool(
    'list_questions',
    {
      title: 'List questions',
      description: "Questions the reviewer asked about the user's product (things the code alone cannot tell).",
      inputSchema: { status: z.enum(['open', 'answered', 'all']).default('open') },
      annotations: readOnly,
    },
    async ({ status }) => {
      const statuses = status === 'open' ? ['open'] : status === 'answered' ? ['answered', 'auto_answered'] : ['open', 'answered', 'auto_answered', 'dismissed']
      const qs = await listQuestions(userId, statuses)
      return ok(qs.map((q) => ({ id: q.id, repo: q.repo, question: q.question, rationale: q.rationale, status: q.status, answer: q.answer, answer_source: q.answer_source, evidence: q.evidence })))
    },
  )

  if (auth.scopes.includes('openscan:write')) {
    const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const

    server.registerTool(
      'start_scan',
      {
        title: 'Start a scan',
        description: 'Queue a security report (or a fresh repository read) for one linked repository. Returns the scan id; poll get_scan for progress.',
        inputSchema: { repo: repoArg, kind: z.enum(['security', 'understand']).default('security') },
        annotations: { ...write, idempotentHint: false },
      },
      async ({ repo, kind }) => {
        const r = await resolveRepo(userId, repo)
        if (!r) return fail(`Repository ${repo} is not linked to openscan.`)
        const id = await startScanFor(userId, r.id, kind)
        if (!id) return fail(`Repository ${repo} is not linked to openscan.`)
        return ok({ scan_id: id, repo: r.full_name, kind, status: 'queued', url: reportUrl(id) })
      },
    )

    server.registerTool(
      'answer_question',
      {
        title: 'Answer a question',
        description: "Answer one of the reviewer's questions. The answer becomes product memory used by every later scan.",
        inputSchema: { question_id: z.string().min(1), answer: z.string().min(1).max(4000) },
        annotations: { ...write, idempotentHint: true },
      },
      async ({ question_id, answer }) =>
        (await answerQuestionFor(userId, question_id, answer)) ? ok({ ok: true, question_id }) : fail(`Question ${question_id} was not found.`),
    )

    server.registerTool(
      'update_finding_status',
      {
        title: 'Update a finding',
        description: 'Mark a finding fixed or dismissed (or reopen it).',
        inputSchema: { finding_id: z.string().min(1), status: z.enum(['open', 'fixed', 'dismissed']) },
        annotations: { ...write, idempotentHint: true },
      },
      async ({ finding_id, status }) =>
        (await setFindingStatus(userId, finding_id, status)) ? ok({ ok: true, finding_id, status }) : fail(`Finding ${finding_id} was not found.`),
    )
  }

  return server
}

/** /mcp: authenticate the Bearer token, then serve one JSON-RPC exchange statelessly. */
export async function handleMcp(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight()
  const auth = await authenticateMcp(request)
  if (auth instanceof Response) return auth
  // Stateless server: no standalone SSE stream (GET) and no sessions to end (DELETE).
  if (request.method !== 'POST') {
    return withCors(Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }, { status: 405, headers: { allow: 'POST, OPTIONS' } }))
  }
  const server = buildMcpServer(auth)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  const res = await transport.handleRequest(request, {
    authInfo: {
      token: auth.token,
      clientId: auth.clientId,
      scopes: auth.scopes,
      expiresAt: Math.floor(auth.expiresAt / 1000),
      resource: new URL(issuerUrls(appUrl()).resource),
    },
  })
  return withCors(res)
}
