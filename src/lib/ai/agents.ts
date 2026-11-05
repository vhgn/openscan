/** Prompts + output schemas for each agent role in the scan pipeline. */
import { z } from 'zod'
import type { Preferences, RepoProfile } from '../types'

const severity = z.enum(['critical', 'high', 'medium', 'low', 'info'])

export const newQuestion = z.object({
  question: z.string().describe('A specific question about the project a security reviewer would need answered'),
  rationale: z.string().describe('Why the answer changes the security assessment'),
})
export const answer = z.object({
  questionId: z.string(),
  answer: z.string(),
  evidence: z.string().describe('File path(s) / snippet proving the answer'),
})

// ---------- Reader (repo understanding during onboarding) ----------

export const readerOutput = z.object({
  notes: z.array(z.string()).describe('Durable facts learned from these files (stack, data flow, trust boundaries, auth, deployment)'),
  questions: z.array(newQuestion).describe('New open questions that the code alone cannot answer yet. Max 3.'),
  answers: z.array(answer).describe('Answers to previously open questions that these files settle'),
})

export const READER_SYSTEM = `You are the "reader" agent of openscan, an AI application-security product.
You read a repository batch by batch to build an accurate mental model BEFORE any security review.
Rules:
- Record concise, durable facts as notes (no speculation without saying so).
- Raise questions only when the answer materially changes security risk (exposure, data sensitivity, auth model, tenancy, deployment, threat model). Do not ask what the code already shows.
- When files you are reading settle an open question, answer it with evidence (file path). Prefer answering over asking.
- Never invent files you were not shown.`

export function readerPrompt(input: {
  repo: string
  overview: string
  notes: string[]
  openQuestions: Array<{ id: string; question: string }>
  files: Array<{ path: string; content: string }>
  userContext: string
}) {
  return `Repository: ${input.repo}
User-provided context: ${input.userContext || '(none yet)'}

Directory overview:
${input.overview}

Notes so far:
${input.notes.length ? input.notes.map((n) => `- ${n}`).join('\n') : '(none)'}

Open questions (answer them if these files settle them):
${input.openQuestions.length ? input.openQuestions.map((q) => `[${q.id}] ${q.question}`).join('\n') : '(none)'}

Files in this batch:
${input.files.map((f) => `=== ${f.path} ===\n${f.content}`).join('\n\n')}`
}

// ---------- Profile synthesis ----------

export const profileOutput = z.object({
  summary: z.string(),
  stack: z.array(z.string()),
  entryPoints: z.array(z.string()),
  dataStores: z.array(z.string()),
  auth: z.string(),
  externalServices: z.array(z.string()),
  deployment: z.string(),
  sensitiveAreas: z.array(z.string()).describe('Paths or path fragments that deserve the closest security review'),
  notes: z.array(z.string()),
  answers: z.array(answer),
})

export const PROFILE_SYSTEM = `You are the "architect" agent of openscan. Turn reading notes into a precise repository profile
that a security reviewer will rely on. Be concrete (name files, frameworks, data stores). If unknown, say "Unknown".
Also answer any open question the notes already settle.`

export function profilePrompt(input: { repo: string; overview: string; notes: string[]; openQuestions: Array<{ id: string; question: string }>; userContext: string }) {
  return `Repository: ${input.repo}
User context: ${input.userContext || '(none)'}
Directory overview:
${input.overview}

Reading notes:
${input.notes.map((n) => `- ${n}`).join('\n')}

Open questions:
${input.openQuestions.map((q) => `[${q.id}] ${q.question}`).join('\n') || '(none)'}`
}

// ---------- Security reviewer ----------

export const findingSchema = z.object({
  severity,
  category: z.enum(['code', 'dependency', 'secret', 'config', 'ci']),
  title: z.string(),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  description: z.string().describe('What is wrong, referencing the code'),
  threatModel: z.string().describe('"An attacker with <capability> can <action> to achieve <impact>"'),
  trace: z.array(z.string()).describe('Source → sink path as "file:line — step", from the lower-trust entry point to the affected resource'),
  impact: z.string().describe('What an attacker gains, in this specific app'),
  recommendation: z.string().describe('Smallest effective fix at the last trusted decision point, plus a regression test idea'),
  confidence: z.enum(['high', 'medium', 'low']),
})

export const reviewOutput = z.object({
  findings: z.array(findingSchema),
  questions: z.array(newQuestion).describe('Questions you could not answer from code that block a confident verdict. Max 2.'),
  answers: z.array(answer),
})

export function reviewSystem(prefs: Preferences, playbook: string) {
  return `You are the "reviewer" agent of openscan. Review code for real, exploitable security problems.
${playbook}

Report only issues with a plausible attack path in THIS application; skip style nits and generic advice.
Calibrate severity to the repository profile and known answers (exposure, data, auth model).
Focus areas requested by the user: ${prefs.focus.join(', ')}.
Audience: ${prefs.audience}. Minimum severity of interest: ${prefs.minSeverity}.
If something would be critical only under an unknown assumption, report it with lower confidence AND ask the question.
Files marked CHANGED come from the push that triggered this scan.`
}

export function reviewPrompt(input: {
  repo: string
  profile: RepoProfile | null
  knownAnswers: Array<{ question: string; answer: string }>
  openQuestions: Array<{ id: string; question: string }>
  files: Array<{ path: string; content: string }>
  userContext: string
  changed?: string[]
}) {
  return `Repository: ${input.repo}
User context: ${input.userContext || '(none)'}
${input.changed?.length ? `CHANGED files in the triggering push: ${input.changed.slice(0, 40).join(', ')}\n` : ''}Profile: ${input.profile ? JSON.stringify(input.profile) : '(not built yet)'}

Known answers:
${input.knownAnswers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n') || '(none)'}

Open questions (answer if these files settle them):
${input.openQuestions.map((q) => `[${q.id}] ${q.question}`).join('\n') || '(none)'}

Files:
${input.files.map((f) => `=== ${f.path}${input.changed?.includes(f.path) ? ' (CHANGED)' : ''} ===\n${f.content}`).join('\n\n')}`
}

// ---------- Triage / report ----------

export const triageOutput = z.object({
  headline: z.string().describe('One sentence: the single most important takeaway'),
  riskLevel: z.enum(['critical', 'high', 'medium', 'low', 'none']),
  whatMatters: z.array(z.string()).describe('3-5 bullets on what actually matters, in plain language'),
  nextActions: z.array(z.object({ action: z.string(), why: z.string(), effort: z.enum(['small', 'medium', 'large']) })),
  ranking: z
    .array(z.object({ index: z.number().int(), priority: z.number().int(), severity, falsePositive: z.boolean() }))
    .describe('For every finding index: fix-order priority (1 = first), adjusted severity, and whether it is a likely false positive'),
  research: z
    .array(z.object({ index: z.number().int(), poc: z.string() }))
    .describe('Only when deep research is requested: for serious findings, a proof-of-concept / exploit narrative and how to verify the fix'),
})

export function triageSystem(prefs: Preferences, playbook: string) {
  return `${playbook}

You are the "triage lead" agent of openscan. The customer said: "I don't want a raw scanner report. I want to
understand what matters, what is risky, and what I should do next."
Deduplicate mentally, rank findings by real-world risk for this app, flag likely false positives, and write for a ${prefs.audience} audience.
${
  prefs.depth === 'deep_poc'
    ? 'Deep research is requested: for each critical/high (non-false-positive) finding write a short PoC: preconditions, request/payload or steps, expected result, and how to verify the fix. Keep PoCs safe for the owner to run against their own environment.'
    : 'Deep research is NOT requested: return an empty research array.'
}`
}

export function triagePrompt(input: {
  repo: string
  profile: RepoProfile | null
  knownAnswers: Array<{ question: string; answer: string }>
  findings: Array<{ index: number; severity: string; category: string; title: string; file: string | null; description: string; confidence: string; verdict: string | null }>
}) {
  return `Repository: ${input.repo}
Profile: ${input.profile ? JSON.stringify(input.profile) : '(unknown)'}
Known answers: ${input.knownAnswers.map((a) => `${a.question} -> ${a.answer}`).join(' | ') || '(none)'}

Findings:
${input.findings.map((f) => `#${f.index} [${f.severity}/${f.category}/${f.confidence}${f.verdict ? `/validator:${f.verdict}` : ''}] ${f.title} (${f.file ?? 'n/a'})\n  ${f.description.slice(0, 400)}`).join('\n') || '(no findings)'}

Findings marked validator:confirmed were independently verified; validator:needs_validation depend on an owner-answerable fact (no severity — mention them as open questions, not risks).`
}

// ---------- Validator (fresh agent per finding) ----------

export const validateOutput = z.object({
  restatedClaim: z.string().describe('Step 0: the exact claim, root cause, trigger and impact in your own words'),
  gates: z.object({
    reachability: z.enum(['pass', 'fail', 'unknown']),
    realImpact: z.enum(['pass', 'fail', 'unknown']),
    noPreventingControl: z.enum(['pass', 'fail', 'unknown']),
    environment: z.enum(['pass', 'fail', 'unknown']),
  }),
  brocardFailed: z.number().int().min(0).max(7).describe('Number of the first brocard the finding fails, or 0 if none'),
  decision: z.enum(['confirmed', 'needs_validation', 'rejected']),
  severity: severity.describe('Calibrated severity (only meaningful when confirmed)'),
  reasoning: z.string().describe('Evidence for the decision: the control found, the path verified, or the refutation'),
  missingFact: z.string().describe('For needs_validation: the exact question the repository owner must answer; otherwise empty'),
  correctedRecommendation: z.string().describe('Improved smallest-fix recommendation, or empty to keep the original'),
})

export function validateSystem(playbook: string) {
  return `You are the independent "validator" agent of openscan.
${playbook}`
}

export function validatePrompt(input: {
  repo: string
  profile: RepoProfile | null
  knownAnswers: Array<{ question: string; answer: string }>
  finding: { severity: string; category: string; title: string; file: string | null; line: number | null; description: string; threatModel: string | null; trace: string[]; impact: string | null; recommendation: string | null }
  files: Array<{ path: string; content: string }>
  userContext: string
}) {
  return `Repository: ${input.repo}
User context: ${input.userContext || '(none)'}
Profile: ${input.profile ? JSON.stringify(input.profile) : '(unknown)'}
Known answers from the owner:
${input.knownAnswers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n') || '(none)'}

FINDING UNDER REVIEW (written by another agent):
${JSON.stringify(input.finding, null, 2)}

Source files referenced by the finding:
${input.files.map((f) => `=== ${f.path} ===\n${f.content}`).join('\n\n') || '(could not load referenced files)'}`
}
