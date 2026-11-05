/**
 * A stubbed LLM for scan tests.
 *
 * The app reaches the model through `backgroundLLM(user)` (src/lib/chatgpt.ts), which
 * returns an AI SDK provider bound to the user's ChatGPT plan. mockChatGPT() replaces
 * that module (node:test mock.module, needs --experimental-test-module-mocks) with one
 * whose provider serves an AI SDK MockLanguageModelV4. Everything after that is real:
 * askJson -> streamText -> structured output parsing -> zod validation -> engine.
 *
 * The responder sees which agent is asking (from its system prompt) and returns the
 * object (or raw text) the "model" streams back.
 */
import { mock } from 'node:test'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'

export type AgentRole = 'reader' | 'architect' | 'reviewer' | 'validator' | 'triage' | 'unknown'

export interface LlmCall {
  role: AgentRole
  system: string
  prompt: string
  /** x-login-with-chatgpt-reasoning-effort header. */
  effort: string | undefined
  /** True when the AI SDK asked for JSON output (structured mode). */
  json: boolean
}

export type Responder = (call: LlmCall) => unknown

function roleOf(system: string): AgentRole {
  if (system.includes('You are the "reader" agent')) return 'reader'
  if (system.includes('You are the "architect" agent')) return 'architect'
  if (system.includes('You are the "reviewer" agent')) return 'reviewer'
  if (system.includes('You are the independent "validator" agent')) return 'validator'
  if (system.includes('You are the "triage lead" agent')) return 'triage'
  return 'unknown'
}

/** The stream parts a provider emits for one text answer. */
export function textStream(text: string) {
  return convertArrayToReadableStream([
    { type: 'stream-start' as const, warnings: [] },
    { type: 'text-start' as const, id: 't1' },
    { type: 'text-delta' as const, id: 't1', delta: text },
    { type: 'text-end' as const, id: 't1' },
    {
      type: 'finish' as const,
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
    },
  ])
}

/** A language model that answers every call with `respond(call)` (objects are JSON-encoded). */
export function fakeModel(respond: Responder, calls: LlmCall[] = []) {
  return new MockLanguageModelV4({
    provider: 'stub',
    modelId: 'gpt-stub',
    doStream: async (options) => {
      let system = ''
      let prompt = ''
      for (const m of options.prompt) {
        if (m.role === 'system') system += m.content
        else if (m.role === 'user') for (const part of m.content) if (part.type === 'text') prompt += part.text
      }
      const call: LlmCall = {
        role: roleOf(system),
        system,
        prompt,
        effort: options.headers?.['x-login-with-chatgpt-reasoning-effort'] ?? undefined,
        json: options.responseFormat?.type === 'json',
      }
      calls.push(call)
      const out = respond(call)
      return { stream: textStream(typeof out === 'string' ? out : JSON.stringify(out)) }
    },
  })
}

/**
 * Replaces src/lib/chatgpt.ts for the rest of this test file. Must run before the
 * first import of anything that loads it (the engine, actions, routes...): import those
 * dynamically after calling this. Users with `chatgpt_cookie_enc` set are "linked".
 */
export function mockChatGPT(respond: Responder) {
  const calls: LlmCall[] = []
  const model = fakeModel(respond, calls)
  mock.module(new URL('../../src/lib/chatgpt.ts', import.meta.url).href, {
    namedExports: {
      backgroundLLM: async (user: { chatgpt_cookie_enc: string | null }) => (user.chatgpt_cookie_enc ? { provider: () => model, model: 'gpt-stub' } : null),
      // No Codex Cloud: scans use the direct ChatGPT engine.
      codexCredentials: async () => null,
    },
  })
  return { calls, model }
}
