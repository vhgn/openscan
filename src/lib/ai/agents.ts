/** Prompts + output schemas for each agent role in the scan pipeline. */
import { z } from 'zod'
import type { Preferences, RepoProfile } from '../types'
import { dataFence, type DataFence } from './untrusted'

const severity = z.enum(['critical', 'high', 'medium', 'low', 'info'])

export const newQuestion = z.object({
  question: z
    .string()
    .describe(
      'A specific, high-impact question only the owner can answer: about intent, deployment, users or data, never about what the code does. Its answer must change a severity or a verdict',
    ),
  rationale: z.string().describe('Which findings or severities the answer changes, and how'),
})

/**
 * Shared bar for raising owner questions ("Questions for you" in the brief).
 * Owners answer these by hand, so only ask what moves the security outcome.
 */
export const QUESTION_RULES = `Questions for the owner (shown to them as "Questions for you"):
- Ask only the few questions whose answers have the biggest impact on the security assessment: they would raise or lower a severity, confirm or reject a finding, or change which parts of the code are attack surface. Typical examples: internet exposure, who the users and attackers are, data sensitivity, the intended auth/role model, tenancy, deployment controls not visible in source.
- Ask only about what is NOT in the repository: intent, the deployment and network around the code, who the users are, what the data is. The owner is not a code oracle.
- Never ask how the code behaves: whether a function authenticates or authorizes requests, validates input, is reachable, who calls it, whether it relies on its caller being trusted, what a config or handler does. That answer is in the code. Go find it: search for the callers, route and listener registration, middleware, guards and config, and decide from that evidence. If the code you need is not in front of you yet, write a note "TO VERIFY IN CODE: <what and where to look>" instead of a question.
  Bad: "Do \`connector.fetch\` and \`config.fetch\` authenticate every request, or rely on the listener's caller being trusted?" (read both handlers and where the listener is created).
  Good: "Is the public listener reachable from the internet, or only from inside your private network?" (deployment, not visible in source).
- If a question needs a function, file, variable or config-key name to make sense, it is a code question: answer it from the code, do not ask it.
- Do NOT ask about small architecture or implementation details (which library, folder layout, naming, how a module is wired, coding conventions, build tooling).
- Before asking, check: "If the owner answers either way, would a finding or severity change?" If not, do not ask.
- Fewer is better; returning no questions is fine. Never rephrase an existing open question or known answer.
- The owner SKIPPED some earlier questions (listed under "Skipped questions"). Treat each as a signal that the owner does not want that kind of question: never ask it again, never ask a reworded or narrower variant of it, and avoid questions on the same topic.`

/** Prompt block listing the questions the owner skipped, so agents stop asking that kind of thing. */
export function skippedBlock(skipped: string[] = []) {
  return `Skipped questions (the owner chose not to answer these; do NOT ask them or anything similar):
${skipped.length ? skipped.map((q) => `- ${q}`).join('\n') : '(none)'}`
}

export const answer = z.object({
  questionId: z.string(),
  answer: z.string(),
  evidence: z.string().describe('File path(s) / snippet proving the answer'),
})

// ---------- Reader (repo understanding during onboarding) ----------

export const readerOutput = z.object({
  notes: z.array(z.string()).describe('Durable facts learned from these files (stack, data flow, trust boundaries, auth, deployment)'),
  questions: z.array(newQuestion).describe('New high-impact open questions the code alone cannot answer. Max 3; usually 0-1.'),
  answers: z.array(answer).describe('Answers to previously open questions that these files settle'),
})

export const READER_SYSTEM = `You are the "reader" agent of openscan, an AI application-security product.
You read a repository batch by batch to build an accurate mental model BEFORE any security review.
Rules:
- Record concise, durable facts as notes (no speculation without saying so).
${QUESTION_RULES}
- When files you are reading settle an open question, answer it with evidence (file path). Prefer answering over asking.
- An open question about code behaviour that you can settle from these files: answer it. One you can't settle yet: leave it, and add a "TO VERIFY IN CODE" note so the reviewer checks it.
- Never invent files you were not shown.`

export function readerPrompt(input: {
  repo: string
  overview: string
  notes: string[]
  openQuestions: Array<{ id: string; question: string }>
  files: Array<{ path: string; content: string }>
  userContext: string
  skippedQuestions?: string[]
  fence?: DataFence
}) {
  const d = input.fence ?? dataFence()
  return `${d.header}

Repository: ${input.repo}
User-provided context: ${input.userContext || '(none yet)'}

Directory overview:
${d.block('directory-listing', input.overview)}

Notes so far (written by the reader from repository content):
${input.notes.length ? d.block('reading-notes', input.notes.map((n) => `- ${n}`).join('\n')) : '(none)'}

Open questions (answer them if these files settle them):
${input.openQuestions.length ? input.openQuestions.map((q) => `[${q.id}] ${q.question}`).join('\n') : '(none)'}

${skippedBlock(input.skippedQuestions)}

Files in this batch:
${input.files.map((f) => d.block('file', f.content, { path: f.path })).join('\n\n')}`
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
Also answer any open question the notes already settle.
Keep every "TO VERIFY IN CODE: …" reading note (unless the other notes settle it) in the profile's notes, so the reviewer checks it in the code.`

export function profilePrompt(input: {
  repo: string
  overview: string
  notes: string[]
  openQuestions: Array<{ id: string; question: string }>
  userContext: string
  fence?: DataFence
}) {
  const d = input.fence ?? dataFence()
  return `${d.header}

Repository: ${input.repo}
User context: ${input.userContext || '(none)'}
Directory overview:
${d.block('directory-listing', input.overview)}

Reading notes (written by the reader from repository content):
${d.block('reading-notes', input.notes.map((n) => `- ${n}`).join('\n'))}

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
  questions: z.array(newQuestion).describe('High-impact questions you could not answer from code that block a confident verdict. Max 2; usually 0.'),
  answers: z.array(answer),
})

export function reviewSystem(prefs: Preferences, playbook: string) {
  return `You are the "reviewer" agent of openscan. Review code for real, exploitable security problems.
${playbook}

Report only issues with a plausible attack path in THIS application; skip style nits and generic advice.
Calibrate severity to the repository profile and known answers (exposure, data, auth model).
Profile notes starting "TO VERIFY IN CODE" are open points about how the code behaves: settle them from the files you are shown (answer, finding, or nothing to report), never by asking the owner.
Focus areas requested by the user: ${prefs.focus.join(', ')}.
Audience: ${prefs.audience}. Minimum severity of interest: ${prefs.minSeverity}.
If something would be critical only under an unknown assumption, report it with lower confidence AND ask the question.
${QUESTION_RULES}
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
  skippedQuestions?: string[]
  fence?: DataFence
}) {
  const d = input.fence ?? dataFence()
  return `${d.header}

Repository: ${input.repo}
User context: ${input.userContext || '(none)'}
${input.changed?.length ? `CHANGED files in the triggering push: ${d.block('file-list', input.changed.slice(0, 40).join(', '))}\n` : ''}Profile (built by openscan from repository content): ${input.profile ? d.block('profile', JSON.stringify(input.profile)) : '(not built yet)'}

Known answers:
${input.knownAnswers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n') || '(none)'}

Open questions (answer if these files settle them):
${input.openQuestions.map((q) => `[${q.id}] ${q.question}`).join('\n') || '(none)'}

${skippedBlock(input.skippedQuestions)}

Files:
${input.files.map((f) => d.block('file', f.content, { path: f.path, changed: input.changed?.includes(f.path) ? 'yes' : undefined })).join('\n\n')}`
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
  fence?: DataFence
}) {
  const d = input.fence ?? dataFence()
  return `${d.header}

Repository: ${input.repo}
Profile (built by openscan from repository content): ${input.profile ? d.block('profile', JSON.stringify(input.profile)) : '(unknown)'}
Known answers: ${input.knownAnswers.map((a) => `${a.question} -> ${a.answer}`).join(' | ') || '(none)'}

Findings (written by openscan agents from repository content):
${input.findings.length ? d.block('findings', input.findings.map((f) => `#${f.index} [${f.severity}/${f.category}/${f.confidence}${f.verdict ? `/validator:${f.verdict}` : ''}] ${f.title} (${f.file ?? 'n/a'})\n  ${f.description.slice(0, 400)}`).join('\n')) : '(no findings)'}

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
  fence?: DataFence
}) {
  const d = input.fence ?? dataFence()
  return `${d.header}

Repository: ${input.repo}
User context: ${input.userContext || '(none)'}
Profile (built by openscan from repository content): ${input.profile ? d.block('profile', JSON.stringify(input.profile)) : '(unknown)'}
Known answers from the owner:
${input.knownAnswers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n') || '(none)'}

FINDING UNDER REVIEW (written by another agent from repository content; verify it, don't trust it):
${d.block('finding', JSON.stringify(input.finding, null, 2))}

Source files referenced by the finding:
${input.files.map((f) => d.block('file', f.content, { path: f.path })).join('\n\n') || '(could not load referenced files)'}`
}
