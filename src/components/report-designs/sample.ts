/**
 * Sample signed-in brief shown on /design and linked from the landing page
 * ("See a sample brief"). Loosely shaped like the real scan detail
 * (src/lib/queries.ts → scanDetail); the live page is src/routes/scans.$scanId.tsx.
 */
export type Verdict = 'confirmed' | 'needs_validation' | 'rejected' | null

export interface ReportFinding {
  id: string
  priority: number
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: string
  source: string
  title: string
  file: string
  line: number | null
  verdict: Verdict
  threatModel?: string
  trace?: string[]
  description: string
  impact?: string
  fix: string
  effort?: string
  poc?: string
  verification?: string
}

export interface ReportData {
  user: { login: string; initials: string }
  product: { name: string; repos: string[] }
  scan: {
    id: string
    repo: string
    commit: string
    branch: string
    date: string
    trigger: string
    engine: string
    risk: 'critical' | 'high' | 'medium' | 'low' | 'none'
    headline: string
    filesReviewed: number
    dependenciesChecked: number
    validation: { confirmed: number; needs_validation: number; rejected: number }
    memory: { skippedFiles: number; reusedVerdicts: number }
  }
  whatMatters: string[]
  nextActions: Array<{ action: string; why: string; effort: string }>
  findings: ReportFinding[]
  rejected: Array<{ title: string; reason: string }>
  questions: Array<{ question: string; why: string; status: 'open' | 'answered'; answer?: string; by?: 'ai' | 'you' }>
  codexTasks: Array<{ role: string; status: string; minutes: number }>
  skills: Array<{ name: string; publisher: string }>
  activity: Array<{ time: string; message: string }>
}

export const SAMPLE_REPORT: ReportData = {
  user: { login: 'acme-cto', initials: 'AC' },
  product: { name: 'Payments platform', repos: ['acme/payments-api', 'acme/checkout-web', 'acme/infra'] },
  scan: {
    id: 'OS-7F3C-0457',
    repo: 'acme/payments-api',
    commit: '9c41e07',
    branch: 'main',
    date: 'Monday, 3 November 2026',
    trigger: 'weekly report',
    engine: 'Codex Cloud',
    risk: 'high',
    headline: 'Forged Stripe webhooks can mark any invoice as paid. Fix this before anything else.',
    filesReviewed: 41,
    dependenciesChecked: 612,
    validation: { confirmed: 4, needs_validation: 1, rejected: 9 },
    memory: { skippedFiles: 128, reusedVerdicts: 4 },
  },
  whatMatters: [
    'Anyone on the internet can send a fake "invoice paid" event; the handler trusts it.',
    'The production image runs Node 20, which no longer receives security fixes.',
    'Whether the admin export is a real risk depends on one answer from your team.',
  ],
  nextActions: [
    { action: 'Verify the Stripe signature on the raw body before any state change.', why: 'Closes the only verified path to revenue loss.', effort: '½ day' },
    { action: 'Move the runtime to Node 22.23.4, keeping the alpine image.', why: 'Clears CVE-2026-111497 and nine related fixes.', effort: '1 hour' },
    { action: 'Upgrade jsonwebtoken to 9.0.2.', why: 'Both advisories are reachable from /auth.', effort: '30 min' },
  ],
  findings: [
    {
      id: 'f1',
      priority: 1,
      severity: 'high',
      category: 'code',
      source: 'AI review',
      title: 'Stripe webhook signature is never verified',
      file: 'src/handlers/stripe.ts',
      line: 18,
      verdict: 'confirmed',
      threatModel: 'An unauthenticated attacker can POST a forged event to mark any invoice as paid.',
      trace: [
        'src/routes/webhooks.ts:9 — POST /webhooks/stripe is public',
        'src/handlers/stripe.ts:14 — body parsed as JSON, signature header ignored',
        'src/handlers/stripe.ts:18 — invoices.markPaid(event.data.object.id)',
        'src/db/invoices.ts:41 — UPDATE invoices SET status = \'paid\'',
      ],
      description: 'The handler parses the request body and acts on it without calling stripe.webhooks.constructEvent, so the Stripe-Signature header is never checked.',
      impact: 'Revenue loss: any invoice can be marked paid without payment.',
      fix: 'Read the raw body, call stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET) and reject on failure before any state change. Add a regression test that a forged event returns 400.',
      effort: '½ day',
      poc: 'curl -X POST "$HOST/webhooks/stripe" \\\n  -H "content-type: application/json" \\\n  -d \'{"type":"invoice.paid","data":{"object":{"id":"in_test_123"}}}\'\n# expected now: 200 and invoice in_test_123 marked paid\n# expected after fix: 400 signature verification failed',
      verification: 'Reachability ✓ public route. Impact ✓ state change on invoices. No upstream control ✓ no middleware verifies signatures. Environment ✓ nothing in wrangler or the gateway config filters this route.',
    },
    {
      id: 'f2',
      priority: 2,
      severity: 'high',
      category: 'config',
      source: 'runtime advisory',
      title: 'Node 20 runtime is end-of-life (CVE-2026-111497)',
      file: 'Dockerfile',
      line: 1,
      verdict: 'confirmed',
      description: 'FROM node:20.11-alpine. Node 20 receives no fixes for the October 2026 security release, including the Brotli decoder out-of-bounds write.',
      fix: 'FROM node:22.23.4-alpine, rebuild with --pull and record the new digest.',
      effort: '1 hour',
    },
    {
      id: 'f3',
      priority: 3,
      severity: 'medium',
      category: 'dependency',
      source: 'OSV.dev',
      title: 'jsonwebtoken@8.5.1 has 2 known vulnerabilities',
      file: 'package-lock.json',
      line: null,
      verdict: 'confirmed',
      description: 'GHSA-8cf7-32gw-wr33 and GHSA-hjrf-2m68-5959. The vulnerable verify() path is reachable from src/auth/session.ts.',
      fix: 'Upgrade to jsonwebtoken 9.0.2 (major bump: review algorithm options).',
      effort: '30 min',
    },
    {
      id: 'f4',
      priority: 4,
      severity: 'medium',
      category: 'code',
      source: 'AI review',
      title: 'Admin export reachable without a role check',
      file: 'src/routes/admin/export.ts',
      line: 12,
      verdict: 'needs_validation',
      description: 'GET /admin/export streams all invoices as CSV. It requires a session but not the admin role.',
      fix: 'Require role === "admin" in the route guard, or confirm the panel is only reachable on the internal network.',
      verification: 'Missing fact: is /admin served on the public hostname, or only behind the VPN?',
    },
    {
      id: 'f5',
      priority: 5,
      severity: 'low',
      category: 'ci',
      source: 'agentic-actions rules',
      title: 'Deploy workflow uses an action pinned to a tag, not a commit',
      file: '.github/workflows/deploy.yml',
      line: 22,
      verdict: 'confirmed',
      description: 'uses: some-org/deploy-action@v3 runs with the production deploy token.',
      fix: 'Pin to the full commit SHA and let Dependabot keep it current.',
      effort: '15 min',
    },
  ],
  rejected: [
    { title: 'SQL injection in report filters', reason: 'The value is bound as a parameter by the ORM at src/db/reports.ts:27.' },
    { title: 'JWT "none" algorithm accepted', reason: 'algorithms: ["HS256"] is passed to verify() at src/auth/session.ts:33.' },
    { title: 'Path traversal in receipt uploads', reason: 'Filenames are replaced with UUIDs before reaching storage.' },
  ],
  questions: [
    { question: 'Is the /admin panel served on the public hostname, or only behind the VPN?', why: 'Decides whether the admin export finding is medium or nothing.', status: 'open' },
    { question: 'Do invoice exports contain card or bank details?', why: 'Raises the impact of any export leak.', status: 'answered', answer: 'No. Only invoice ids, amounts and customer emails.', by: 'you' },
    { question: 'Which service terminates TLS?', why: 'Needed to judge header-based controls.', status: 'answered', answer: 'Cloudflare, per wrangler.jsonc routes.', by: 'ai' },
  ],
  codexTasks: [
    { role: 'recon', status: 'completed', minutes: 6 },
    { role: 'hunt', status: 'completed', minutes: 14 },
    { role: 'validate', status: 'completed', minutes: 9 },
  ],
  skills: [
    { name: 'security-audit', publisher: 'Cloudflare' },
    { name: 'Claude Code Security Review', publisher: 'Anthropic' },
    { name: 'fp-check', publisher: 'Trail of Bits' },
    { name: 'vulnerability-triage-brocards', publisher: 'Trail of Bits' },
    { name: 'supply-chain-risk-auditor', publisher: 'Trail of Bits' },
    { name: 'agentic-actions-auditor', publisher: 'Trail of Bits' },
  ],
  activity: [
    { time: '09:01', message: 'Product memory: skipping 128 files already reviewed at their current version' },
    { time: '09:02', message: 'Checked 612 dependencies against OSV.dev: 1 vulnerable package' },
    { time: '09:03', message: 'Codex Cloud hunt task started on main' },
    { time: '09:17', message: 'Codex hunt examined 41 files → 14 findings' },
    { time: '09:26', message: 'Validator: 4 confirmed, 1 needs input, 9 rejected' },
    { time: '09:27', message: 'Triage: brief ready' },
  ],
}
