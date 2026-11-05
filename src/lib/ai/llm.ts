/**
 * Structured LLM calls through the user's ChatGPT plan.
 * We stream (the ChatGPT Codex backend is stream-first), ask for a JSON object
 * matching a zod schema, and fall back to tolerant JSON extraction.
 */
import { Output, streamText } from 'ai'
import type { z } from 'zod'
import type { BackgroundLLM } from '../chatgpt'

export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.search(/[[{]/)
  if (start === -1) throw new Error('No JSON in model output')
  const open = candidate[start]
  const close = open === '{' ? '}' : ']'
  const end = candidate.lastIndexOf(close)
  return JSON.parse(candidate.slice(start, end + 1))
}

/** Sentinel used when AI_MODE=mock (local pipeline testing; never for real scans). */
export const MOCK_LLM = { provider: null, model: 'mock' } as unknown as BackgroundLLM

export async function askJson<S extends z.ZodTypeAny>(
  llm: BackgroundLLM,
  opts: { system: string; prompt: string; schema: S; effort?: 'low' | 'medium' | 'high'; name?: string },
): Promise<z.infer<S>> {
  if (llm.model === 'mock') return opts.schema.parse(mockResponse(opts.name ?? '', opts.prompt))
  const headers = { 'x-login-with-chatgpt-reasoning-effort': opts.effort ?? 'medium' }
  try {
    const result = streamText({
      model: llm.provider(llm.model),
      system: opts.system,
      prompt: opts.prompt,
      headers,
      output: Output.object({ schema: opts.schema }),
    })
    return (await result.output) as z.infer<S>
  } catch (structuredError) {
    // Some models/accounts reject json_schema formatting: retry as plain text.
    const result = streamText({
      model: llm.provider(llm.model),
      system: `${opts.system}\n\nRespond with ONLY a single JSON object. No prose, no markdown fences.`,
      prompt: opts.prompt,
      headers,
    })
    const text = await result.text
    const parsed = opts.schema.safeParse(extractJson(text))
    if (!parsed.success) {
      throw new Error(`Model returned invalid JSON (${parsed.error.issues[0]?.message ?? 'schema mismatch'}); first error: ${String(structuredError).slice(0, 200)}`)
    }
    return parsed.data
  }
}

// ---------------------------------------------------------------- mock (AI_MODE=mock)

let mockCounter = 0
/** Deterministic, schema-valid responses that exercise every pipeline branch. */
export function mockResponse(name: string, prompt: string): unknown {
  const files = [...prompt.matchAll(/=== ([^\n]+?)(?: \(CHANGED\))? ===/g)].map((m) => m[1])
  const qid = /\[([0-9a-f-]{36})\]/.exec(prompt)?.[1]
  switch (name) {
    case 'reader':
      return {
        notes: files.slice(0, 2).map((f) => `Read ${f}`).concat(files[0] ? [`UNENFORCED: input from ${files[0]} is assumed validated upstream`] : []),
        questions: [{ question: 'Is the admin interface reachable from the public internet?', rationale: 'Changes severity of admin-only issues.' }],
        answers: qid ? [{ questionId: qid, answer: 'Mock: answered from code while reading.', evidence: files[0] ?? 'n/a' }] : [],
      }
    case 'profile':
      return { summary: 'Mock profile.', stack: ['Node.js'], entryPoints: files.slice(0, 2), dataStores: ['Unknown'], auth: 'Unknown', externalServices: [], deployment: 'Unknown', sensitiveAreas: ['auth', 'routes'], notes: [], answers: [] }
    case 'review': {
      const f = files.find((x) => /\.(js|ts|py|go|rb|php)$/.test(x))
      return {
        findings: f
          ? [{ severity: 'high', category: 'code', title: `Mock: unvalidated input reaches a sensitive sink in ${f}`, file: f, line: 1, description: 'Mock finding for pipeline testing.', threatModel: 'An attacker with an account can send crafted input to achieve data access.', trace: [`${f}:1 — reads request input`, `${f}:2 — passes it to the sink`], impact: 'Mock impact.', recommendation: 'Mock fix.', confidence: 'medium' }]
          : [],
        questions: [],
        answers: [],
      }
    }
    case 'validate': {
      const decision = (['confirmed', 'needs_validation', 'rejected'] as const)[mockCounter++ % 3]
      return {
        restatedClaim: 'Mock restatement of the claim.',
        gates: { reachability: 'pass', realImpact: decision === 'rejected' ? 'fail' : 'pass', noPreventingControl: decision === 'confirmed' ? 'pass' : 'unknown', environment: 'pass' },
        brocardFailed: decision === 'rejected' ? 3 : 0,
        decision,
        severity: 'medium',
        reasoning: `Mock validator decided ${decision}.`,
        missingFact: decision === 'needs_validation' ? 'Is this endpoint protected by an authenticating reverse proxy in production?' : '',
        correctedRecommendation: '',
      }
    }
    case 'triage': {
      const n = [...prompt.matchAll(/^#(\d+) /gm)].map((m) => Number(m[1]))
      return {
        headline: 'Mock: fix the verified finding first.',
        riskLevel: 'high',
        whatMatters: ['Mock bullet'],
        nextActions: [{ action: 'Mock action', why: 'Mock reason', effort: 'small' }],
        ranking: n.map((index, i) => ({ index, priority: i + 1, severity: 'medium', falsePositive: false })),
        research: [],
      }
    }
    case 'codex-recon':
      return { ...(mockResponse('profile', prompt) as object), summary: 'Mock profile from a Codex Cloud recon task.', questions: [{ question: 'Which of these services are internet-facing?', rationale: 'Exposure drives severity.' }] }
    case 'codex-hunt': {
      const priority = [...prompt.matchAll(/high-signal files: ([^\n]+)/g)].flatMap((m) => m[1].split(', '))
      const target = priority.find((p) => /\.(js|ts|py|go|rb|php)$/.test(p)) ?? 'src/server.js'
      const r = mockResponse('review', `=== ${target} ===`) as { findings: unknown[] }
      return { ...r, filesExamined: 42, reviewedPaths: priority.slice(0, 10) }
    }
    case 'codex-validate': {
      const n = (prompt.match(/"index":/g) ?? []).length
      return { verdicts: Array.from({ length: n }, (_, index) => ({ index, ...(mockResponse('validate', '') as object) })) }
    }
    default:
      throw new Error(`mock: unknown agent "${name}"`)
  }
}
