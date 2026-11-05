/**
 * The HTTP API contract: request/response schemas for every route under
 * src/routes/api, and the registry `npm run generate` turns into
 * public/openapi.json (served at /openapi.json).
 *
 * Route handlers import their request schemas from here, so the spec and the
 * validation can't drift apart. The generator fails if a file under
 * src/routes/api has no entry in API_ROUTES (or in UNDOCUMENTED_ROUTES).
 *
 * Keep this module pure (zod only): the generator runs it in Node, outside workerd.
 */
import { z } from 'zod'

// ---------------------------------------------------------------- shared

const SEVERITY = z.enum(['critical', 'high', 'medium', 'low', 'info'])
const SCAN_KIND = z.enum(['understand', 'security'])
const SCAN_STATUS = z.enum(['queued', 'running', 'completed', 'failed'])
const millis = z.number().int().describe('Unix time in milliseconds')

export const ApiError = z
  .object({
    error: z.string().describe('Machine-readable code, e.g. unauthenticated, invalid_body, repo_not_found'),
    message: z.string().optional().describe('Human-readable explanation'),
    issues: z.array(z.unknown()).optional().describe('Validation issues (invalid_body only)'),
  })
  .meta({ id: 'Error' })

// ---------------------------------------------------------------- scans

const kind = SCAN_KIND.default('security').describe('security: a full security brief. understand: re-read the repository profile.')

export const StartScanBody = z
  .union([
    z.object({ productId: z.string().describe('Review every repository of this product (one product scan).') }).meta({ id: 'StartProductScanRequest' }),
    z
      .object({
        repo: z
          .string()
          .trim()
          .min(1)
          .max(300)
          .describe('"owner/name" or a github.com URL. Any public repository works without installing the GitHub App; it is linked to your account on the way.'),
        kind,
      })
      .meta({ id: 'StartRepoScanByNameRequest' }),
    z.object({ repoId: z.number().int().describe('Id of a repository already linked to your account (repo_id in the scans list).'), kind }).meta({ id: 'StartRepoScanByIdRequest' }),
  ])
  .meta({ id: 'StartScanRequest' })

export const StartScanResponse = z
  .union([
    z
      .object({
        id: z.string().describe('Repository scan id'),
        repo: z.string().describe('owner/name'),
        url: z.string().describe('Path of the report page'),
      })
      .meta({ id: 'StartRepoScanResponse' }),
    z
      .object({
        productScanId: z.string().nullable(),
        scanIds: z.array(z.string()).describe('One repository scan per member'),
        url: z.string().describe('Path of the product page'),
      })
      .meta({ id: 'StartProductScanResponse' }),
  ])
  .meta({ id: 'StartScanResponse' })

export const ScanListItem = z
  .object({
    id: z.string(),
    repo: z.string().describe('owner/name'),
    repo_id: z.number().int().describe('Negative for public repositories added by name'),
    product_scan_id: z.string().nullable().describe('The product scan this repository scan belongs to'),
    kind: SCAN_KIND,
    trigger: z.string().describe('manual, push, schedule or onboarding'),
    status: SCAN_STATUS,
    phase: z.string(),
    progress: z.number().int().min(0).max(100),
    engine: z.string().nullable(),
    created_at: millis,
    finished_at: millis.nullable(),
    risk: z.string().nullable().describe('Overall risk of a completed security brief (critical … low, or none)'),
    headline: z.string().nullable(),
    findings: z.number().int().describe('Open findings in this scan'),
  })
  .meta({ id: 'ScanListItem' })

export const ProductScanItem = z
  .object({
    id: z.string(),
    product_id: z.string(),
    product: z.string().describe('Product name'),
    trigger: z.string(),
    status: SCAN_STATUS.describe('Derived from its repository scans'),
    progress: z.number().int().min(0).max(100),
    created_at: millis,
    finished_at: millis.nullable(),
    risk: z.string().nullable().describe('Worst risk across its repository scans'),
    findings: z.number().int(),
    push: z.object({ repo: z.string().nullable(), commit_sha: z.string().nullable() }).nullable().describe('Set when a push started it'),
    scans: z.array(ScanListItem),
  })
  .meta({ id: 'ProductScan' })

export const ScanList = z
  .object({
    productScans: z.array(ProductScanItem).describe('The 50 most recent product scans, each with its repository scans'),
    scans: z.array(ScanListItem).describe('The 100 most recent repository scans, flat'),
  })
  .meta({ id: 'ScanList' })

const Finding = z
  .looseObject({
    id: z.string(),
    scan_id: z.string(),
    repo: z.string(),
    severity: SEVERITY,
    category: z.string(),
    title: z.string(),
    file: z.string().nullable(),
    line: z.number().int().nullable(),
    description: z.string(),
    impact: z.string().nullable(),
    recommendation: z.string().nullable(),
    poc: z.string().nullable().describe('Proof of concept, when depth is deep_poc'),
    confidence: z.string().nullable(),
    status: z.enum(['open', 'dismissed', 'fixed']),
    verdict: z.string().nullable().describe('Validator verdict, e.g. confirmed'),
    areas: z.array(z.string()).describe('Product areas (auth, payments, …)'),
    created_at: millis,
  })
  .meta({ id: 'Finding' })

const Question = z
  .looseObject({
    id: z.string(),
    question: z.string(),
    rationale: z.string().nullable(),
    status: z.enum(['open', 'auto_answered', 'answered', 'dismissed']),
    answer: z.string().nullable(),
    answer_source: z.string().nullable(),
    evidence: z.string().nullable(),
    created_at: millis,
  })
  .meta({ id: 'Question' })

export const ScanDetail = z
  .object({
    scan: z
      .looseObject({
        id: z.string(),
        repo: z.string(),
        repo_id: z.number().int(),
        kind: SCAN_KIND,
        status: SCAN_STATUS,
        phase: z.string(),
        progress: z.number().int(),
        error: z.string().nullable(),
        summary: z
          .looseObject({ riskLevel: SEVERITY.optional(), headline: z.string().optional() })
          .nullable()
          .describe('The brief: risk, headline, what matters, next actions (completed security scans)'),
        created_at: millis,
        finished_at: millis.nullable(),
      })
      .describe('Scan row plus the parsed summary'),
    profile: z.looseObject({}).nullable().describe("The repository profile: stack, entry points, data stores, auth, sensitive areas"),
    skills: z.array(z.string()).describe('Security skills applied'),
    codexTasks: z.array(z.object({ role: z.string(), id: z.string(), url: z.string(), status: z.string() })),
    events: z.array(z.object({ id: z.number().int(), ts: millis, level: z.string(), message: z.string() })).describe('Event log, oldest first (last 200)'),
    findings: z.array(Finding),
    questions: z.array(Question),
  })
  .meta({ id: 'ScanDetail' })

// ---------------------------------------------------------------- registry

export type Auth = 'session' | 'webhook' | 'agent' | 'none'

export interface ApiRoute {
  method: 'get' | 'post'
  /** OpenAPI path ({param} style). */
  path: string
  /** The TanStack route id the handler is registered under (createFileRoute). */
  routeId: string
  summary: string
  description?: string
  tags: string[]
  auth: Auth
  pathParams?: Record<string, string>
  query?: Record<string, { description: string; required?: boolean }>
  headers?: Record<string, { description: string; required?: boolean }>
  body?: z.ZodType
  /** Status → description and, for JSON, its schema (or `text: true` for a text/plain body). */
  responses: Record<number, { description: string; schema?: z.ZodType; redirect?: boolean; text?: boolean }>
}

const unauthenticated = { description: 'No valid session cookie', schema: ApiError }
const agentUnauthorized = { description: 'Missing, expired or revoked token (or its scan is no longer running)', text: true }

export const API_ROUTES: ApiRoute[] = [
  {
    method: 'get',
    path: '/api/scans',
    routeId: '/api/scans/',
    summary: 'List your scans',
    description: 'Product scans (each with its repository scans) and the flat list of repository scans (security briefs and repository reads), newest first.',
    tags: ['Scans'],
    auth: 'session',
    responses: { 200: { description: 'Scans', schema: ScanList }, 401: unauthenticated },
  },
  {
    method: 'post',
    path: '/api/scans',
    routeId: '/api/scans/',
    summary: 'Start a scan',
    description:
      'Reviews a whole product (`productId`), or one repository inside its product: any public GitHub repository by `repo` ("owner/name" or a github.com URL), or a linked one by `repoId`; `kind: understand` re-reads it instead. Scans run in the background: poll `GET /api/scans/{scanId}`.',
    tags: ['Scans'],
    auth: 'session',
    body: StartScanBody,
    responses: {
      202: { description: 'Queued (or the already running scan of that repository)', schema: StartScanResponse },
      400: { description: 'invalid_body, or invalid_repo when `repo` is not a GitHub repository', schema: ApiError },
      401: unauthenticated,
      404: { description: 'product_not_found, repo_not_found (not linked, or no such public repository) or repo_private', schema: ApiError },
      409: { description: 'product_has_no_repositories, or scan_not_started', schema: ApiError },
      503: { description: 'github_unavailable: GitHub could not be reached to look the repository up', schema: ApiError },
    },
  },
  {
    method: 'get',
    path: '/api/scans/{scanId}',
    routeId: '/api/scans/$scanId',
    summary: 'Get a scan',
    description: 'Status, phase, progress, event log and, once completed, the brief: summary, findings and questions.',
    tags: ['Scans'],
    auth: 'session',
    pathParams: { scanId: 'Scan id' },
    responses: {
      200: { description: 'The scan', schema: ScanDetail },
      401: unauthenticated,
      404: { description: 'not_found: no such scan for this user', schema: ApiError },
    },
  },
  {
    method: 'post',
    path: '/api/github/webhook',
    routeId: '/api/github/webhook',
    summary: 'GitHub App webhook',
    description:
      'Receives `installation`, `installation_repositories` and `push` events. The raw body must be signed with `GITHUB_WEBHOOK_SECRET` (HMAC-SHA256, `X-Hub-Signature-256`). Pushes to the default branch start a review for every user watching the repository.',
    tags: ['GitHub'],
    auth: 'webhook',
    headers: {
      'X-Hub-Signature-256': { description: '`sha256=` + hex HMAC-SHA256 of the raw body', required: true },
      'X-GitHub-Event': { description: 'installation, installation_repositories or push', required: true },
    },
    body: z.looseObject({}).describe('GitHub webhook payload'),
    responses: { 200: { description: 'Processed (or ignored)' }, 401: { description: 'bad signature' } },
  },
  {
    method: 'get',
    path: '/api/github/setup',
    routeId: '/api/github/setup',
    summary: 'GitHub App Setup URL',
    description: 'GitHub redirects here after the app is installed or its repository access changes. Resyncs repositories, then redirects into the app.',
    tags: ['GitHub'],
    auth: 'session',
    responses: { 302: { description: 'To the repositories step, or to sign-in without a session', redirect: true } },
  },
  {
    method: 'get',
    path: '/api/auth/github/login',
    routeId: '/api/auth/github/login',
    summary: 'Sign in with GitHub',
    tags: ['Auth'],
    auth: 'none',
    query: { next: { description: 'Same-site path to return to after signing in' } },
    responses: { 302: { description: "To GitHub's authorization page (or to `next` when already signed in)", redirect: true } },
  },
  {
    method: 'get',
    path: '/api/auth/github/callback',
    routeId: '/api/auth/github/callback',
    summary: 'GitHub OAuth callback',
    description: 'Exchanges the code, upserts the user, syncs repositories and sets the `openscan_session` cookie.',
    tags: ['Auth'],
    auth: 'none',
    query: { code: { description: 'Set by GitHub', required: true }, state: { description: 'Must match the state cookie', required: true } },
    responses: { 302: { description: 'Signed in: to `next` or the landing path', redirect: true }, 400: { description: 'Invalid OAuth state' } },
  },
  ...(['get', 'post'] as const).map(
    (method): ApiRoute => ({
      method,
      path: '/api/auth/logout',
      routeId: '/api/auth/logout',
      summary: 'Sign out',
      tags: ['Auth'],
      auth: 'none',
      responses: { 302: { description: 'Session cleared, to /', redirect: true } },
    }),
  ),
  {
    method: 'get',
    path: '/api/dev/login',
    routeId: '/api/dev/login',
    summary: 'Demo sign-in (development only)',
    description: 'Only when `DEV_DEMO_LOGIN=1` (404 otherwise). Signs in a demo user and links the given public repositories.',
    tags: ['Auth'],
    auth: 'none',
    query: { repos: { description: 'Comma-separated owner/name list (default OWASP/NodeGoat,juice-shop/juice-shop)' }, next: { description: 'Path to land on' } },
    responses: { 302: { description: 'Signed in', redirect: true }, 404: { description: 'Demo login disabled' } },
  },
  {
    method: 'get',
    path: '/api/agent/ping',
    routeId: '/api/agent/$',
    summary: 'Agent: check reachability',
    description: 'For Codex Cloud tasks: confirms openscan is reachable from the task environment. Plain text.',
    tags: ['Agent'],
    auth: 'agent',
    responses: { 200: { description: 'ok', text: true }, 401: agentUnauthorized },
  },
  {
    method: 'get',
    path: '/api/agent/memory',
    routeId: '/api/agent/$',
    summary: 'Agent: product memory index',
    description: "For Codex Cloud tasks: what the product's memory holds for this repository, with links to each view. Plain text, readable straight from `curl`.",
    tags: ['Agent'],
    auth: 'agent',
    responses: { 200: { description: 'Index', text: true }, 401: agentUnauthorized, 403: { description: 'This token has no memory access', text: true } },
  },
  {
    method: 'get',
    path: '/api/agent/memory/{view}',
    routeId: '/api/agent/$',
    summary: 'Agent: one memory view',
    description: 'facts: known facts about the product. verdicts: this repository’s earlier verdicts. reviewed: files already reviewed. repos: the other repositories of the product. Plain text.',
    tags: ['Agent'],
    auth: 'agent',
    pathParams: { view: 'facts, verdicts, reviewed or repos' },
    query: {
      q: { description: 'facts, verdicts: search text' },
      file: { description: 'verdicts: only this file' },
      path: { description: 'reviewed: only this path' },
    },
    responses: {
      200: { description: 'The view', text: true },
      401: agentUnauthorized,
      403: { description: 'This token has no memory access', text: true },
      404: { description: 'Unknown view', text: true },
    },
  },
]

/** API route files deliberately left out of the spec, with the reason. */
export const UNDOCUMENTED_ROUTES: Record<string, string> = {
  '/api/chatgpt/$':
    'login-with-chatgpt SDK routes (login, status, session, models, responses, …), owned and documented by https://github.com/opencoredev/login-with-chatgpt',
}
