import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCodexClient, parseTaskDetails, pickEnvironment, taskUrl, CodexCloudError } from '../src/lib/codex/cloud.ts'
import { huntPrompt, parseTaskOutput, reconPrompt, validatePrompt } from '../src/lib/codex/prompts.ts'
import { defaultPreferences } from '../src/lib/types.ts'

function fakeFetch(routes: Record<string, (init?: RequestInit) => { status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const key = `${init?.method ?? 'GET'} ${url}`
    const handler = routes[key]
    if (!handler) return new Response('not found', { status: 404 })
    const r = handler(init)
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
  }
  return { fn, calls }
}

test('client discovers environments by repo with ChatGPT auth headers', async () => {
  const f = fakeFetch({
    'GET https://chatgpt.com/backend-api/wham/environments/by-repo/github/acme/api': () => ({
      body: [
        { id: 'env_a', label: 'old', task_count: 3 },
        { id: 'env_b', label: 'main', is_pinned: true, task_count: 1 },
      ],
    }),
  })
  const c = createCodexClient({ accessToken: 'tok', accountId: 'acct' }, f.fn)
  const envs = await c.environmentsForRepo('acme/api')
  assert.equal(pickEnvironment(envs)?.id, 'env_b')
  const h = f.calls[0].init?.headers as Record<string, string>
  assert.equal(h.authorization, 'Bearer tok')
  assert.equal(h['chatgpt-account-id'], 'acct')
  assert.deepEqual(await c.environmentsForRepo('acme/missing'), [])
})

test('createTask posts the codex cloud payload in Ask mode and returns the id', async () => {
  let body: any
  const f = fakeFetch({
    'POST https://chatgpt.com/backend-api/wham/tasks': (init) => {
      body = JSON.parse(String(init?.body))
      return { body: { task: { id: 'task_123' } } }
    },
  })
  const c = createCodexClient({ accessToken: 't', accountId: 'a' }, f.fn)
  assert.equal(await c.createTask({ environmentId: 'env_b', branch: 'main', prompt: 'hi' }), 'task_123')
  assert.deepEqual(body.new_task, { environment_id: 'env_b', branch: 'main', run_environment_in_qa_mode: true })
  assert.deepEqual(body.input_items[0].content[0], { content_type: 'text', text: 'hi' })
  assert.equal(taskUrl('task_123'), 'https://chatgpt.com/codex/tasks/task_123')
})

test('errors carry the HTTP status', async () => {
  const f = fakeFetch({ 'POST https://chatgpt.com/backend-api/wham/tasks': () => ({ status: 401, body: { detail: 'expired' } }) })
  const c = createCodexClient({ accessToken: 't', accountId: 'a' }, f.fn)
  await assert.rejects(c.createTask({ environmentId: 'e', branch: 'main', prompt: 'x' }), (e: unknown) => e instanceof CodexCloudError && e.status === 401)
})

test('parseTaskDetails maps status and collects assistant text from output items and worklog', () => {
  assert.equal(parseTaskDetails({}).status, 'pending')
  const r = parseTaskDetails({
    current_assistant_turn: {
      turn_status: 'completed',
      output_items: [{ type: 'message', role: 'assistant', content: [{ content_type: 'text', text: '{"a":1}' }, { content_type: 'image', text: 'x' }] }, { type: 'pr', content: [] }],
      worklog: { messages: [{ author: { role: 'assistant' }, content: { parts: ['thinking out loud'] } }, { author: { role: 'tool' }, content: { parts: ['ignored'] } }] },
    },
  })
  assert.equal(r.status, 'completed')
  assert.deepEqual(r.messages, ['{"a":1}', 'thinking out loud'])
  const failed = parseTaskDetails({ current_assistant_turn: { turn_status: 'failed', error: { code: 'env_setup', message: 'install failed' } } })
  assert.equal(failed.error, 'env_setup: install failed')
})

test('prompts carry the role marker, read-only rules and the JSON contract', () => {
  const r = reconPrompt({ repo: 'acme/api', userContext: '', openQuestions: [{ id: 'q1', question: 'Public?' }] })
  assert.match(r.prompt, /OPENSCAN-ROLE: recon/)
  assert.match(r.prompt, /Do not modify files/)
  assert.match(r.prompt, /"sensitiveAreas"/)
  assert.match(r.prompt, /\[q1\] Public\?/)
  const h = huntPrompt({ repo: 'acme/api', prefs: defaultPreferences, profile: null, knownAnswers: [], openQuestions: [], alreadyFound: ['lodash@4.17.20 has 1 known vulnerability'], changed: ['src/a.ts'], priorityFiles: ['src/a.ts'] })
  assert.match(h.prompt, /OPENSCAN-ROLE: hunt/)
  assert.match(h.prompt, /HARD EXCLUSIONS/)
  assert.match(h.prompt, /lodash@4\.17\.20/)
  assert.ok(h.skills.includes('tob-differential-review'))
  const v = validatePrompt({ repo: 'acme/api', prefs: defaultPreferences, profile: null, knownAnswers: [], findings: [] })
  assert.match(v.prompt, /OPENSCAN-ROLE: validate/)
  assert.ok(v.skills.includes('tob-fp-check'))
})

test('question prompts carry the high-impact rule and the skipped questions', () => {
  const r = reconPrompt({ repo: 'acme/api', userContext: '', openQuestions: [], skippedQuestions: ['Which logging library is used?'] })
  assert.match(r.prompt, /Questions for you/)
  assert.match(r.prompt, /small architecture or implementation details/)
  assert.match(r.prompt, /Skipped questions[^\n]*\n- Which logging library is used\?/)
  const h = huntPrompt({ repo: 'acme/api', prefs: defaultPreferences, profile: null, knownAnswers: [], openQuestions: [], alreadyFound: [], priorityFiles: [] })
  assert.match(h.prompt, /Skipped questions[^\n]*\n\(none\)/)
})

test('parseTaskOutput takes the last message that satisfies the contract', () => {
  const good = { verdicts: [{ index: 0, restatedClaim: 'x', gates: { reachability: 'pass', realImpact: 'pass', noPreventingControl: 'pass', environment: 'pass' }, brocardFailed: 0, decision: 'confirmed', severity: 'high', reasoning: 'r', missingFact: '', correctedRecommendation: '' }] }
  assert.deepEqual(parseTaskOutput('validate', ['Plan: …', '```json\n' + JSON.stringify(good) + '\n```', 'Done.'])?.verdicts[0].decision, 'confirmed')
  assert.equal(parseTaskOutput('validate', ['{"verdicts": "nope"}']), null)
})

test('recon prompt: the agent settles code-behaviour questions itself, with the whole repository', () => {
  const r = reconPrompt({ repo: 'acme/api', userContext: '', openQuestions: [] })
  assert.match(r.prompt, /settle every question about how the code behaves yourself/)
  assert.match(r.prompt, /Never ask how the code behaves/)
})
