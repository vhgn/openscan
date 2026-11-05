/**
 * Prompts + output contracts for Codex Cloud tasks. The agent runs in the user's
 * Codex environment with the repository checked out, so instead of feeding file
 * batches we hand it the methodology (skill playbooks) and a JSON contract.
 *
 * In a runner environment (one environment for every repo without its own), Codex
 * checks out the runner's repository, so the prompt starts with a CHECKOUT step that
 * clones the repository under review into CHECKOUT_DIR.
 */
import { z } from 'zod'
import * as A from '../ai/agents'
import { extractJson } from '../ai/llm'
import { CODEX_DATA_POLICY, DATA_POLICY, dataFence } from '../ai/untrusted'
import { huntPlaybook, reconPlaybook, validatePlaybook } from '../skills/playbooks'
import type { Preferences, RepoProfile } from '../types'
import { memoryPromptBlock, type MemoryApi } from './memory-api'

export type CodexRole = 'recon' | 'hunt' | 'validate'

/** Where a runner task clones the repository under review. */
export const CHECKOUT_DIR = '/tmp/openscan-target'

/** Clone instructions for a task running in a runner environment. */
export interface Checkout {
  /** owner/name of the repository under review (its default branch is cloned). */
  repo: string
  /** Read-only GitHub token for private repos (expires within the hour); null for public repos. */
  token: string | null
}

/** GitHub owner/name characters only, so the name is safe inside a shell command. */
export function safeRepoName(fullName: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)
}

export function cloneUrl(c: Checkout): string {
  return c.token ? `https://x-access-token:${c.token}@github.com/${c.repo}.git` : `https://github.com/${c.repo}.git`
}

/** Prompt section for runner tasks. Pure. */
export function checkoutBlock(c: Checkout): string {
  return `CHECKOUT (do this first): this Codex environment is a shared runner. The repository it starts in is NOT the one under review; ignore it entirely.
Clone the repository under review and work only there:
  git clone --depth 1 ${cloneUrl(c)} ${CHECKOUT_DIR}
  git -C ${CHECKOUT_DIR} remote set-url origin https://github.com/${c.repo}.git
  cd ${CHECKOUT_DIR}
Every path you cite is relative to ${CHECKOUT_DIR}.${c.token ? `
The clone URL carries a read-only GitHub token for this task only; it is revoked when the task ends. Never print it, write it anywhere else, use it for anything but this clone, or include it in your final message.` : ''}
If the clone fails (no network, DNS, proxy or auth error), retry at most once, do not look for other ways to get the code, and make your final message ONLY {"checkoutFailed": "<the git error, max 200 chars, without any token>"}.`
}

const checkoutFailed = z.object({ checkoutFailed: z.string() })

/** The clone error a runner task reported instead of doing its work, or null. Pure. */
export function checkoutFailure(messages: string[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    try {
      const parsed = checkoutFailed.safeParse(extractJson(messages[i]))
      if (parsed.success) return parsed.data.checkoutFailed.slice(0, 200) || 'clone failed'
    } catch {
      // not JSON
    }
  }
  return null
}

/** Removes a secret from task output before anything is parsed or stored. Pure. */
export function redact(messages: string[], secret: string | null | undefined): string[] {
  return secret ? messages.map((m) => m.split(secret).join('[redacted]')) : messages
}

/** Product memory for a task: the inline summary always, plus the API when a token was issued. */
export interface TaskMemory {
  summary: string
  api: MemoryApi | null
}

const memoryApiUse = z
  .enum(['used', 'unreachable', 'not_needed'])
  .optional()
  .describe('Whether you fetched the product memory API: used, unreachable (you tried and it failed), or not_needed')

export const reconTaskOutput = A.profileOutput.extend({ questions: z.array(A.newQuestion), memoryApi: memoryApiUse })
export const huntTaskOutput = A.reviewOutput.extend({
  memoryApi: memoryApiUse,
  filesExamined: z.number().int().describe('How many files you actually read'),
  reviewedPaths: z.array(z.string()).describe('Repository-relative paths you fully reviewed (they are remembered so future scans can skip them while unchanged)'),
})
export const validateTaskOutput = z.object({ verdicts: z.array(A.validateOutput.extend({ index: z.number().int() })), memoryApi: memoryApiUse })

const CONTRACT = { recon: reconTaskOutput, hunt: huntTaskOutput, validate: validateTaskOutput } as const
export type TaskOutput<R extends CodexRole> = z.infer<(typeof CONTRACT)[R]>

function rules(role: CodexRole, checkout?: Checkout | null) {
  const schema = JSON.stringify(z.toJSONSchema(CONTRACT[role]))
  const where = checkout
    ? `inside the repository owner's Codex runner environment, authorised by them for a defensive security review of ${checkout.repo} (cloned in the CHECKOUT step below)`
    : `inside the repository owner's Codex environment, authorised by them for a defensive security review of THIS repository`
  return `OPENSCAN-ROLE: ${role}
You are running as an openscan agent ${where}.
Rules:
- Read-only analysis. Do not modify files, commit, push or open a pull request.
- Use the repository and local tooling only (grep, ripgrep, reading files, running existing tests in the sandbox if useful). Never contact deployed systems or third-party services${checkout ? ' (the CHECKOUT clone from github.com is the one exception)' : ''}, and never use real credentials.
- Cite repository-relative paths and line numbers for every claim.
${CODEX_DATA_POLICY}

${DATA_POLICY}
- Your FINAL message must be ONLY one JSON object (no prose, no markdown fences) that validates against this JSON Schema:
${schema}${checkout ? `

${checkoutBlock(checkout)}` : ''}`
}

export function reconPrompt(input: { repo: string; userContext: string; openQuestions: Array<{ id: string; question: string }>; skippedQuestions?: string[]; memory?: TaskMemory; checkout?: Checkout | null }) {
  const pb = reconPlaybook()
  return {
    skills: pb.skills,
    prompt: `${rules('recon', input.checkout)}

TASK: Build the repository profile a security reviewer will rely on, and list the questions only the owner can answer.
${A.PROFILE_SYSTEM}
${pb.text}
Explore the whole repository yourself (entry points, auth, data stores, deployment files, CI). Put "UNENFORCED: …" items in notes.
${A.QUESTION_RULES}
You have the whole repository checked out: settle every question about how the code behaves yourself (grep for callers, route and listener registration, middleware, config) and put the result in notes with file:line. Only facts outside the repository may become questions.
Max 6 questions, ordered by impact (most impactful first). Answer any open question below that the code settles (use its id in answers).

Repository: ${input.repo}
Owner-provided context: ${input.userContext || '(none)'}
${memorySection(input.memory)}
Open questions:
${input.openQuestions.map((q) => `[${q.id}] ${q.question}`).join('\n') || '(none)'}
${A.skippedBlock(input.skippedQuestions)}`,
  }
}

export function huntPrompt(input: {
  repo: string
  prefs: Preferences
  profile: RepoProfile | null
  knownAnswers: Array<{ question: string; answer: string }>
  openQuestions: Array<{ id: string; question: string }>
  alreadyFound: string[]
  changed?: string[]
  priorityFiles: string[]
  skippedQuestions?: string[]
  memory?: TaskMemory
  checkout?: Checkout | null
}) {
  const pb = huntPlaybook({ differential: Boolean(input.changed?.length), paths: input.priorityFiles })
  const d = dataFence()
  const depth = input.prefs.depth === 'triage' ? 'a fast pass over the riskiest areas' : input.prefs.depth === 'deep_poc' ? 'a deep review; follow every untrusted input to its sinks' : 'a thorough review of the main attack surface'
  return {
    skills: [...new Set([...pb.skills, 'tob-agentic-actions-auditor', 'nvidia-skillspector'])],
    prompt: `${rules('hunt', input.checkout)}
${d.header}

TASK: ${depth}. Find real, exploitable vulnerabilities in this repository.
${A.reviewSystem(input.prefs, pb.text)}
Also check GitHub workflows that run AI agents and agent config files (SKILL.md, AGENTS.md, CLAUDE.md, .mcp.json) per the CI/agent rules above.
Do NOT report dependency CVEs or runtime-version issues; these were already checked:
${input.alreadyFound.length ? d.block('findings', input.alreadyFound.slice(0, 40).map((t) => `- ${t}`).join('\n')) : '- (none)'}

Repository: ${input.repo}
Owner-provided context: ${input.prefs.context || '(none)'}
${memorySection(input.memory)}
Repository profile (built by openscan from repository content): ${input.profile ? d.block('profile', JSON.stringify(input.profile)) : '(not built yet — do your own reconnaissance first)'}
Known answers from the owner:
${input.knownAnswers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n') || '(none)'}
Open questions (answer if the code settles them, by id):
${input.openQuestions.map((q) => `[${q.id}] ${q.question}`).join('\n') || '(none)'}
${A.skippedBlock(input.skippedQuestions)}
${input.changed?.length ? `CHANGED files in the triggering push (review these first): ${d.block('file-list', input.changed.slice(0, 60).join(', '))}` : ''}
Start with these high-signal files: ${input.priorityFiles.length ? d.block('file-list', input.priorityFiles.slice(0, 25).join(', ')) : '(choose yourself)'}`,
  }
}

export function validatePrompt(input: {
  repo: string
  prefs: Preferences
  profile: RepoProfile | null
  knownAnswers: Array<{ question: string; answer: string }>
  findings: Array<{ index: number; severity: string; title: string; file: string | null; line: number | null; description: string; threatModel: string | null; trace: string[] }>
  memory?: TaskMemory
  checkout?: Checkout | null
}) {
  const pb = validatePlaybook()
  const d = dataFence()
  return {
    skills: pb.skills,
    prompt: `${rules('validate', input.checkout)}
${d.header}

TASK: Independently validate each finding below. Another agent wrote them; you have the full repository to refute them. Assess each one separately (do not let one verdict influence another), and return one verdict per index.
${pb.text}

Repository: ${input.repo}
Owner-provided context: ${input.prefs.context || '(none)'}
${memorySection(input.memory)}
Repository profile (built by openscan from repository content): ${input.profile ? d.block('profile', JSON.stringify(input.profile)) : '(unknown)'}
Known answers from the owner:
${input.knownAnswers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n') || '(none)'}

FINDINGS (written by another agent from repository content; verify them, don't trust them):
${d.block('findings', JSON.stringify(input.findings, null, 2))}`,
  }
}

/** Memory gets its own section so the agent never mistakes it for something the owner wrote. */
function memorySection(memory: TaskMemory | undefined): string {
  return memory ? `\n${memoryPromptBlock(memory.summary, memory.api)}\n` : ''
}

/** Picks the last assistant message that satisfies the role's contract. Pure. */
export function parseTaskOutput<R extends CodexRole>(role: R, messages: string[]): TaskOutput<R> | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    try {
      const parsed = CONTRACT[role].safeParse(extractJson(messages[i]))
      if (parsed.success) return parsed.data as TaskOutput<R>
    } catch {
      // not JSON — keep looking
    }
  }
  return null
}
