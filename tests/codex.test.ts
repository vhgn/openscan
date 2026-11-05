import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCodexClient, parseTaskDetails, pickEnvironment, taskUrl, CodexCloudError, CODEX_BLOCKED_MESSAGE, isCodexBlocked, looksLikeHtml } from '../src/lib/codex/cloud.ts'
import { CHECKOUT_DIR, checkoutFailure, cloneUrl, huntPrompt, parseTaskOutput, reconPrompt, redact, safeRepoName, validatePrompt } from '../src/lib/codex/prompts.ts'
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

test('listEnvironments returns every environment in the workspace', async () => {
  const f = fakeFetch({ 'GET https://chatgpt.com/backend-api/wham/environments': () => ({ body: [{ id: 'env_r', label: 'runner' }, { id: 'env_x' }] }) })
  const c = createCodexClient({ accessToken: 't', accountId: 'a' }, f.fn)
  assert.deepEqual(await c.listEnvironments(), [
    { id: 'env_r', label: 'runner', isPinned: false, taskCount: 0 },
    { id: 'env_x', label: null, isPinned: false, taskCount: 0 },
  ])
})

test('runner prompts clone the repository under review before anything else', () => {
  const checkout = { repo: 'acme/private-api', token: 'ghs_secret123' }
  const h = huntPrompt({ repo: 'acme/private-api', prefs: defaultPreferences, profile: null, knownAnswers: [], openQuestions: [], alreadyFound: [], priorityFiles: [], checkout })
  assert.match(h.prompt, /^OPENSCAN-ROLE: hunt/)
  assert.match(h.prompt, /runner environment/)
  assert.ok(h.prompt.includes(`git clone --depth 1 https://x-access-token:ghs_secret123@github.com/acme/private-api.git ${CHECKOUT_DIR}`))
  assert.ok(h.prompt.includes(`remote set-url origin https://github.com/acme/private-api.git`))
  assert.match(h.prompt, /CHECKOUT clone from github\.com is the one exception/)
  assert.match(h.prompt, /Never print it/)
  assert.match(h.prompt, /checkoutFailed/)
  // The checkout step comes before the task itself.
  assert.ok(h.prompt.indexOf('CHECKOUT (do this first)') < h.prompt.indexOf('TASK:'))

  const pub = reconPrompt({ repo: 'acme/oss', userContext: '', openQuestions: [], checkout: { repo: 'acme/oss', token: null } })
  assert.ok(pub.prompt.includes(`git clone --depth 1 https://github.com/acme/oss.git ${CHECKOUT_DIR}`))
  assert.doesNotMatch(pub.prompt, /x-access-token|Never print it/)
  const v = validatePrompt({ repo: 'acme/oss', prefs: defaultPreferences, profile: null, knownAnswers: [], findings: [], checkout: { repo: 'acme/oss', token: null } })
  assert.match(v.prompt, /CHECKOUT \(do this first\)/)

  // A repo with its own environment gets no checkout step.
  const own = reconPrompt({ repo: 'acme/oss', userContext: '', openQuestions: [] })
  assert.doesNotMatch(own.prompt, /CHECKOUT|git clone/)
  assert.match(own.prompt, /review of THIS repository/)
})

test('checkout helpers: clone URL, failure report, redaction, safe names', () => {
  assert.equal(cloneUrl({ repo: 'a/b', token: null }), 'https://github.com/a/b.git')
  assert.equal(checkoutFailure(['working…', '{"checkoutFailed": "fatal: unable to access github.com: Could not resolve host"}']), 'fatal: unable to access github.com: Could not resolve host')
  assert.equal(checkoutFailure(['{"findings": []}']), null)
  assert.deepEqual(redact(['token ghs_x and ghs_x', 'none'], 'ghs_x'), ['token [redacted] and [redacted]', 'none'])
  assert.deepEqual(redact(['a'], null), ['a'])
  assert.ok(safeRepoName('acme/my-repo.js'))
  assert.ok(!safeRepoName('acme/repo;rm -rf /'))
  assert.ok(!safeRepoName('acme/$(id)'))
  assert.ok(!safeRepoName('acme'))
})

test('an HTML 403 from chatgpt.com is reported as blocked, without the page', async () => {
  const page = '<html> <head> <meta name="viewport" content="width=device-width, initial-scale=1" /> <style global>body{}</style></head></html>'
  const events: string[] = []
  const fetchImpl = async (url: string) =>
    url.endsWith('/wham/environments')
      ? new Response(page, { status: 403, headers: { 'content-type': 'text/html; charset=UTF-8' } })
      : url.includes('/by-repo/')
        ? new Response(page, { status: 403 })
        : new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  const c = createCodexClient({ accessToken: 't', accountId: 'a' }, fetchImpl, { onBlocked: () => void events.push('blocked'), onOk: () => void events.push('ok') })

  await assert.rejects(c.listEnvironments(), (e: unknown) => isCodexBlocked(e) && (e as Error).message === CODEX_BLOCKED_MESSAGE && !(e as Error).message.includes('<html'))
  // A blocked by-repo lookup must not read as "no environment".
  await assert.rejects(c.environmentsForRepo('acme/api'), (e: unknown) => isCodexBlocked(e))
  assert.deepEqual(await c.getTask('task_1').then(() => 'done'), 'done')
  assert.deepEqual(events, ['blocked', 'blocked', 'ok'])
})

test('other HTML errors are not "blocked" and never echo the page', async () => {
  const c = createCodexClient({ accessToken: 't', accountId: 'a' }, async () => new Response('<html>bad gateway</html>', { status: 502 }))
  await assert.rejects(c.listEnvironments(), (e: unknown) => e instanceof CodexCloudError && !e.blocked && e.status === 502 && !e.message.includes('<html'))
  // A JSON 403 (e.g. plan without Codex) keeps the API's own message.
  const j = createCodexClient({ accessToken: 't', accountId: 'a' }, async () => new Response('{"detail":"Codex not enabled"}', { status: 403, headers: { 'content-type': 'application/json' } }))
  await assert.rejects(j.listEnvironments(), (e: unknown) => e instanceof CodexCloudError && !e.blocked && e.message.includes('Codex not enabled'))
  assert.ok(looksLikeHtml('  <!DOCTYPE html>', null))
  assert.ok(!looksLikeHtml('{"a":1}', 'application/json'))
})
