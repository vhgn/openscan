/**
 * Prompts + output contracts for Codex Cloud tasks. The agent runs in the user's
 * Codex environment with the repository checked out, so instead of feeding file
 * batches we hand it the methodology (skill playbooks) and a JSON contract.
 */
import { z } from 'zod'
import * as A from '../ai/agents'
import { extractJson } from '../ai/llm'
import { huntPlaybook, reconPlaybook, validatePlaybook } from '../skills/playbooks'
import type { Preferences, RepoProfile } from '../types'
import { memoryPromptBlock, type MemoryApi } from './memory-api'

export type CodexRole = 'recon' | 'hunt' | 'validate'

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

function rules(role: CodexRole) {
  const schema = JSON.stringify(z.toJSONSchema(CONTRACT[role]))
  return `OPENSCAN-ROLE: ${role}
You are running as an openscan agent inside the repository owner's Codex environment, authorised by them for a defensive security review of THIS repository.
Rules:
- Read-only analysis. Do not modify files, commit, push or open a pull request.
- Use the repository and local tooling only (grep, ripgrep, reading files, running existing tests in the sandbox if useful). Never contact deployed systems or third-party services, and never use real credentials.
- Cite repository-relative paths and line numbers for every claim.
- Your FINAL message must be ONLY one JSON object (no prose, no markdown fences) that validates against this JSON Schema:
${schema}`
}

export function reconPrompt(input: { repo: string; userContext: string; openQuestions: Array<{ id: string; question: string }>; memory?: TaskMemory }) {
  const pb = reconPlaybook()
  return {
    skills: pb.skills,
    prompt: `${rules('recon')}

TASK: Build the repository profile a security reviewer will rely on, and list the questions only the owner can answer.
${A.PROFILE_SYSTEM}
${pb.text}
Explore the whole repository yourself (entry points, auth, data stores, deployment files, CI). Put "UNENFORCED: …" items in notes.
Questions must change security risk if answered (exposure, data sensitivity, auth model, tenancy, deployment); max 6. Answer any open question below that the code settles (use its id in answers).

Repository: ${input.repo}
Owner-provided context: ${input.userContext || '(none)'}
${memorySection(input.memory)}
Open questions:
${input.openQuestions.map((q) => `[${q.id}] ${q.question}`).join('\n') || '(none)'}`,
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
  memory?: TaskMemory
}) {
  const pb = huntPlaybook({ differential: Boolean(input.changed?.length), paths: input.priorityFiles })
  const depth = input.prefs.depth === 'triage' ? 'a fast pass over the riskiest areas' : input.prefs.depth === 'deep_poc' ? 'a deep review; follow every untrusted input to its sinks' : 'a thorough review of the main attack surface'
  return {
    skills: [...new Set([...pb.skills, 'tob-agentic-actions-auditor', 'nvidia-skillspector'])],
    prompt: `${rules('hunt')}

TASK: ${depth}. Find real, exploitable vulnerabilities in this repository.
${A.reviewSystem(input.prefs, pb.text)}
Also check GitHub workflows that run AI agents and agent config files (SKILL.md, AGENTS.md, CLAUDE.md, .mcp.json) per the CI/agent rules above.
Do NOT report dependency CVEs or runtime-version issues; these were already checked:
${input.alreadyFound.slice(0, 40).map((t) => `- ${t}`).join('\n') || '- (none)'}

Repository: ${input.repo}
Owner-provided context: ${input.prefs.context || '(none)'}
${memorySection(input.memory)}
Repository profile: ${input.profile ? JSON.stringify(input.profile) : '(not built yet — do your own reconnaissance first)'}
Known answers from the owner:
${input.knownAnswers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n') || '(none)'}
Open questions (answer if the code settles them, by id):
${input.openQuestions.map((q) => `[${q.id}] ${q.question}`).join('\n') || '(none)'}
${input.changed?.length ? `CHANGED files in the triggering push (review these first): ${input.changed.slice(0, 60).join(', ')}` : ''}
Start with these high-signal files: ${input.priorityFiles.slice(0, 25).join(', ') || '(choose yourself)'}`,
  }
}

export function validatePrompt(input: {
  repo: string
  prefs: Preferences
  profile: RepoProfile | null
  knownAnswers: Array<{ question: string; answer: string }>
  findings: Array<{ index: number; severity: string; title: string; file: string | null; line: number | null; description: string; threatModel: string | null; trace: string[] }>
  memory?: TaskMemory
}) {
  const pb = validatePlaybook()
  return {
    skills: pb.skills,
    prompt: `${rules('validate')}

TASK: Independently validate each finding below. Another agent wrote them; you have the full repository to refute them. Assess each one separately (do not let one verdict influence another), and return one verdict per index.
${pb.text}

Repository: ${input.repo}
Owner-provided context: ${input.prefs.context || '(none)'}
${memorySection(input.memory)}
Repository profile: ${input.profile ? JSON.stringify(input.profile) : '(unknown)'}
Known answers from the owner:
${input.knownAnswers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n') || '(none)'}

FINDINGS:
${JSON.stringify(input.findings, null, 2)}`,
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
