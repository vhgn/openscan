/** askJson (src/lib/ai/llm.ts) on a stubbed model, and the pure prompt/schema builders of src/lib/ai/agents.ts. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { askJson } from '../src/lib/ai/llm.ts'
import * as A from '../src/lib/ai/agents.ts'
import { DATA_POLICY, dataFence } from '../src/lib/ai/untrusted.ts'
import { defaultPreferences } from '../src/lib/types.ts'
import type { BackgroundLLM } from '../src/lib/chatgpt.ts'
import { fakeModel, type LlmCall } from './helpers/llm.ts'

const schema = z.object({ answer: z.number() })

function llmFrom(respond: (call: LlmCall, n: number) => unknown) {
  const calls: LlmCall[] = []
  const model = fakeModel((c) => respond(c, calls.length), calls)
  return { calls, llm: { provider: (() => model) as unknown as BackgroundLLM['provider'], model: 'gpt-stub' } satisfies BackgroundLLM }
}

test('askJson: structured output on the first try, effort passed as a header', async () => {
  const { llm, calls } = llmFrom(() => ({ answer: 42 }))
  assert.deepEqual(await askJson(llm, { system: 'sys', prompt: 'p', schema, effort: 'high' }), { answer: 42 })
  assert.equal(calls.length, 1)
  assert.deepEqual([calls[0].system, calls[0].prompt, calls[0].effort, calls[0].json], [`sys\n\n${DATA_POLICY}`, 'p', 'high', true])
  await askJson(llm, { system: 'sys', prompt: 'p', schema })
  assert.equal(calls[1].effort, 'medium', 'default effort')
})

test('askJson: falls back to plain text + tolerant JSON extraction when structured output fails', async () => {
  // First answer does not match the schema (structured parse fails), the retry answers in prose + fences.
  const { llm, calls } = llmFrom((_c, n) => (n === 1 ? { answer: 'forty-two' } : 'Sure:\n```json\n{"answer": 42}\n```'))
  assert.deepEqual(await askJson(llm, { system: 'sys', prompt: 'p', schema }), { answer: 42 })
  assert.equal(calls.length, 2)
  assert.equal(calls[1].json, false, 'the retry is a plain text request')
  assert.ok(calls[1].system.startsWith(`sys\n\n${DATA_POLICY}\n\nRespond with ONLY a single JSON object`))
})

test('askJson: rejects when the retry does not match the schema either', async () => {
  const { llm } = llmFrom(() => ({ nope: true }))
  await assert.rejects(askJson(llm, { system: 's', prompt: 'p', schema }), /Model returned invalid JSON/)
})

// ---------------------------------------------------------------- agents.ts

const triageFinding = { index: 0, severity: 'high', category: 'code', title: 'SQLi', file: 'a.ts', description: 'x'.repeat(500), confidence: 'high', verdict: 'confirmed' }

test('triagePrompt lists findings with verdict tags and truncated descriptions', () => {
  const p = A.triagePrompt({
    repo: 'acme/shop',
    profile: null,
    knownAnswers: [{ question: 'Public?', answer: 'Yes' }],
    findings: [triageFinding, { ...triageFinding, index: 1, title: 'Lib', file: null, verdict: null, description: 'short' }],
    fence: dataFence('t0k3n'),
  })
  assert.match(p, /^Data token for this message: t0k3n\./)
  assert.match(p, /\nRepository: acme\/shop\nProfile \(built by openscan from repository content\): \(unknown\)\nKnown answers: Public\? -> Yes/)
  assert.match(p, /<<<OPENSCAN-DATA t0k3n kind="findings">>>\n#0 /, 'findings sit in a data block')
  assert.match(p, /^#0 \[high\/code\/high\/validator:confirmed\] SQLi \(a\.ts\)\n {2}x{400}$/m)
  assert.match(p, /^#1 \[high\/code\/high\] Lib \(n\/a\)\n {2}short$/m)
  assert.match(A.triagePrompt({ repo: 'r', profile: null, knownAnswers: [], findings: [] }), /Known answers: \(none\)[\s\S]*\(no findings\)/)
})

test('triageSystem asks for PoCs only on deep research', () => {
  assert.match(A.triageSystem({ ...defaultPreferences, depth: 'deep_poc', audience: 'executive' }, 'PLAYBOOK'), /^PLAYBOOK[\s\S]*executive audience[\s\S]*Deep research is requested/)
  assert.match(A.triageSystem(defaultPreferences, ''), /Deep research is NOT requested: return an empty research array/)
})

test('reviewSystem carries the preferences', () => {
  const s = A.reviewSystem({ ...defaultPreferences, focus: ['code', 'ci'], audience: 'security', minSeverity: 'high' }, 'HUNT')
  assert.match(s, /HUNT/)
  assert.match(s, /Focus areas requested by the user: code, ci\./)
  assert.match(s, /Audience: security\. Minimum severity of interest: high\./)
})

test('reviewPrompt marks files changed by the triggering push', () => {
  const p = A.reviewPrompt({
    repo: 'r',
    profile: null,
    knownAnswers: [],
    openQuestions: [{ id: 'q1', question: 'Q?' }],
    files: [{ path: 'a.ts', content: 'A' }, { path: 'b.ts', content: 'B' }],
    userContext: '',
    changed: ['b.ts'],
    fence: dataFence('t0k3n'),
  })
  assert.match(p, /CHANGED files in the triggering push: <<<OPENSCAN-DATA t0k3n kind="file-list">>>\nb\.ts\n<<<END-OPENSCAN-DATA t0k3n>>>/)
  assert.match(p, /<<<OPENSCAN-DATA t0k3n kind="file" path="a\.ts">>>\nA\n<<<END-OPENSCAN-DATA t0k3n>>>/)
  assert.match(p, /<<<OPENSCAN-DATA t0k3n kind="file" path="b\.ts" changed="yes">>>\nB\n<<<END-OPENSCAN-DATA t0k3n>>>/)
  assert.match(p, /\[q1\] Q\?/)
})

test('triageOutput / validateOutput / reviewOutput schemas', () => {
  const triage = {
    headline: 'h',
    riskLevel: 'high',
    whatMatters: ['a'],
    nextActions: [{ action: 'a', why: 'w', effort: 'small' }],
    ranking: [{ index: 0, priority: 1, severity: 'high', falsePositive: false }],
    research: [],
  }
  assert.ok(A.triageOutput.safeParse(triage).success)
  assert.ok(!A.triageOutput.safeParse({ ...triage, riskLevel: 'severe' }).success)
  assert.ok(!A.triageOutput.safeParse({ ...triage, nextActions: [{ action: 'a', why: 'w', effort: 'huge' }] }).success)

  const verdict = {
    restatedClaim: 'c',
    gates: { reachability: 'pass', realImpact: 'fail', noPreventingControl: 'unknown', environment: 'pass' },
    brocardFailed: 0,
    decision: 'rejected',
    severity: 'low',
    reasoning: 'r',
    missingFact: '',
    correctedRecommendation: '',
  }
  assert.ok(A.validateOutput.safeParse(verdict).success)
  assert.ok(!A.validateOutput.safeParse({ ...verdict, brocardFailed: 8 }).success, 'there are 7 brocards')
  assert.ok(!A.validateOutput.safeParse({ ...verdict, decision: 'maybe' }).success)

  const f = { severity: 'high', category: 'code', title: 't', file: null, line: null, description: 'd', threatModel: 't', trace: [], impact: 'i', recommendation: 'r', confidence: 'low' }
  assert.ok(A.reviewOutput.safeParse({ findings: [f], questions: [], answers: [] }).success)
  assert.ok(!A.reviewOutput.safeParse({ findings: [{ ...f, category: 'web' }], questions: [], answers: [] }).success)
})

test('owner questions: code behaviour is looked up in the code, never asked', () => {
  // Every agent that may raise questions gets the shared rules.
  for (const system of [A.READER_SYSTEM, A.reviewSystem(defaultPreferences, '')]) {
    assert.match(system, /Never ask how the code behaves/)
    assert.match(system, /TO VERIFY IN CODE/)
  }
  assert.match(A.PROFILE_SYSTEM, /TO VERIFY IN CODE/, 'reading notes about code to check survive into the profile')
  assert.match(A.newQuestion.shape.question.description ?? '', /never about what the code does/)
})
