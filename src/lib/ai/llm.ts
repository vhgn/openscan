/**
 * Structured LLM calls through the user's ChatGPT plan.
 * We stream (the ChatGPT Codex backend is stream-first), ask for a JSON object
 * matching a zod schema, and fall back to tolerant JSON extraction.
 */
import { Output, streamText } from 'ai'
import type { z } from 'zod'
import type { BackgroundLLM } from '../chatgpt'
import { DATA_POLICY } from './untrusted'

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

export async function askJson<S extends z.ZodTypeAny>(
  llm: BackgroundLLM,
  opts: { system: string; prompt: string; schema: S; effort?: 'low' | 'medium' | 'high' },
): Promise<z.infer<S>> {
  const headers = { 'x-login-with-chatgpt-reasoning-effort': opts.effort ?? 'medium' }
  // Every call keeps repository content apart from instructions (see ./untrusted.ts).
  const system = `${opts.system}\n\n${DATA_POLICY}`
  try {
    const result = streamText({
      model: llm.provider(llm.model),
      system,
      prompt: opts.prompt,
      headers,
      output: Output.object({ schema: opts.schema }),
    })
    return (await result.output) as z.infer<S>
  } catch (structuredError) {
    // Some models/accounts reject json_schema formatting: retry as plain text.
    const result = streamText({
      model: llm.provider(llm.model),
      system: `${system}\n\nRespond with ONLY a single JSON object. No prose, no markdown fences.`,
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
