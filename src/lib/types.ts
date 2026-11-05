import { z } from 'zod'

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
export type Severity = (typeof SEVERITIES)[number]

export const preferencesSchema = z.object({
  /** How often recurring security reports run. */
  frequency: z.enum(['on_push', 'daily', 'weekly', 'monthly', 'manual']).default('weekly'),
  /** How much research backs a report. deep_poc = each serious finding gets a PoC / exploit narrative. */
  depth: z.enum(['triage', 'standard', 'deep_poc']).default('standard'),
  focus: z
    .array(z.enum(['code', 'dependencies', 'secrets', 'config', 'ci']))
    .min(1)
    .default(['code', 'dependencies', 'secrets', 'config', 'ci']),
  /** Findings below this are hidden from reports (still stored). */
  minSeverity: z.enum(['critical', 'high', 'medium', 'low', 'info']).default('low'),
  /** Who reads the report: changes tone of summaries. */
  audience: z.enum(['developer', 'security', 'executive']).default('developer'),
  /** Free-form context the user gives about the product (exposure, data, compliance...). */
  context: z.string().max(4000).default(''),
})
export type Preferences = z.infer<typeof preferencesSchema>
export const defaultPreferences: Preferences = preferencesSchema.parse({})

export type OnboardingStep = 'repos' | 'chatgpt' | 'preferences' | 'waiting' | 'done'

export interface UserRow {
  id: string
  github_id: number
  login: string
  name: string | null
  avatar_url: string | null
  gh_token_enc: string | null
  gh_refresh_enc: string | null
  gh_token_expires_at: number | null
  chatgpt_cookie_enc: string | null
  chatgpt_email: string | null
  chatgpt_plan: string | null
  onboarding_step: OnboardingStep
  onboarded_at: number | null
  /** Codex environment used for repos without one of their own (tasks clone the repo first). */
  codex_runner_env_id?: string | null
  codex_runner_env_label?: string | null
  codex_runner_branch?: string | null
  /** Last time chatgpt.com's bot protection refused a Codex Cloud request from the server; cleared by any success. */
  codex_blocked_at?: number | null
}

export interface RepoRow {
  id: number
  installation_id: number | null
  full_name: string
  default_branch: string | null
  private: number
  html_url: string | null
  description: string | null
  language: string | null
  profile_json: string | null
  understood_at: number | null
  /** Set when the repo was removed from the GitHub App; the row stays so scan history survives. */
  removed_at: number | null
}

export type ScanKind = 'understand' | 'security'
export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ScanRow {
  id: string
  user_id: string
  repo_id: number
  kind: ScanKind
  trigger: string
  status: ScanStatus
  phase: string
  progress: number
  engine: string | null
  model: string | null
  commit_sha: string | null
  state_json: string
  summary_json: string | null
  error: string | null
  attempts: number
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
  /** Product that owned the repo when the scan was queued. */
  product_id: string | null
  /** The product scan (one review of a product) this repository scan belongs to. */
  product_scan_id: string | null
  /** Step lease (src/lib/scanner/lease.ts): who is running a step and until when. */
  lease_id: string | null
  lease_until: number | null
}

export interface RepoProfile {
  summary: string
  stack: string[]
  entryPoints: string[]
  dataStores: string[]
  auth: string
  externalServices: string[]
  deployment: string
  sensitiveAreas: string[]
  notes: string[]
}

export interface ScanSummary {
  headline: string
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'none'
  whatMatters: string[]
  nextActions: Array<{ action: string; why: string; effort: 'small' | 'medium' | 'large' }>
  stats: Record<Severity, number>
  filesReviewed: number
  dependenciesChecked: number
  engineNote?: string
  /** Findings whose verdict hinges on a fact outside the source (Cloudflare needs_validation). */
  needsValidation?: Array<{ title: string; missingFact: string }>
  /** Work saved by product memory in this scan. */
  memory?: { skippedFiles: number; reusedVerdicts: number; carriedFindings?: number }
  /** Validation outcome counts. */
  validation?: { confirmed: number; needs_validation: number; rejected: number; unverified: number }
}

export interface FindingDraft {
  severity: Severity
  category: 'code' | 'dependency' | 'secret' | 'config' | 'ci'
  title: string
  file?: string | null
  line?: number | null
  description: string
  impact?: string | null
  recommendation?: string | null
  confidence?: 'high' | 'medium' | 'low'
  poc?: string | null
  /** Source → sink trace ("file:line — step"), per the Cloudflare candidate gate. */
  trace?: string[] | null
  /** "An attacker with <capability> can <action> to achieve <impact>" (brocard 1). */
  threatModel?: string | null
  source?: 'ai-review' | 'heuristic' | 'osv' | 'runtime-advisory' | 'code-scanning' | 'supply-chain'
  skills?: string[]
}
