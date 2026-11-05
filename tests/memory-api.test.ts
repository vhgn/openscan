import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agentApiBase,
  bearerToken,
  codeState,
  formatFacts,
  formatReviewed,
  formatVerdicts,
  matchesQuery,
  memoryPromptBlock,
  probePrompt,
  settleProbe,
} from '../src/lib/codex/memory-api.ts'
import { huntPrompt, parseTaskOutput, reconPrompt, validatePrompt } from '../src/lib/codex/prompts.ts'
import { defaultPreferences } from '../src/lib/types.ts'

const api = { baseUrl: 'https://openscan.example/api/agent', token: 'tok_' + 'x'.repeat(40), expiresAt: Date.UTC(2026, 10, 5, 12, 0) }

test('the API is only advertised on a public https URL', () => {
  assert.equal(agentApiBase('https://openscan.example/'), 'https://openscan.example/api/agent')
  assert.equal(agentApiBase('http://openscan.example'), null)
  assert.equal(agentApiBase('https://localhost:3000'), null)
  assert.equal(agentApiBase('https://127.0.0.1'), null)
  assert.equal(agentApiBase('not a url'), null)
})

test('bearerToken accepts only a well-formed bearer header', () => {
  assert.equal(bearerToken(`Bearer ${'a'.repeat(43)}`), 'a'.repeat(43))
  assert.equal(bearerToken('Bearer short'), null)
  assert.equal(bearerToken('Basic abcdefghijklmnopqrstuvwxyz'), null)
  assert.equal(bearerToken(null), null)
})

test('memory block keeps the inline summary and adds the API only with a token', () => {
  const inline = memoryPromptBlock('PRODUCT MEMORY: fact A', null)
  assert.equal(inline, 'PRODUCT MEMORY: fact A')
  const both = memoryPromptBlock('PRODUCT MEMORY: fact A', api)
  assert.match(both, /^PRODUCT MEMORY: fact A/)
  assert.match(both, /Authorization: Bearer tok_x+/)
  assert.match(both, /\/memory\/verdicts\?file=/)
  assert.match(both, /do not retry/)
  assert.match(both, /2026-11-05T12:00:00\.000Z/)
  assert.match(memoryPromptBlock('', null), /first scan/)
})

test('Codex prompts put memory in its own section, not in the owner context', () => {
  const memory = { summary: 'PRODUCT MEMORY: auth is JWT', api }
  const prefs = { ...defaultPreferences, context: 'internal tool' }
  for (const p of [
    reconPrompt({ repo: 'acme/api', userContext: 'internal tool', openQuestions: [], memory }).prompt,
    huntPrompt({ repo: 'acme/api', prefs, profile: null, knownAnswers: [], openQuestions: [], alreadyFound: [], priorityFiles: [], memory }).prompt,
    validatePrompt({ repo: 'acme/api', prefs, profile: null, knownAnswers: [], findings: [], memory }).prompt,
  ]) {
    assert.match(p, /Owner-provided context: internal tool\n/)
    assert.match(p, /\nPRODUCT MEMORY: auth is JWT/)
    assert.match(p, /PRODUCT MEMORY API/)
    assert.match(p, /"memoryApi"/)
  }
  assert.doesNotMatch(huntPrompt({ repo: 'acme/api', prefs, profile: null, knownAnswers: [], openQuestions: [], alreadyFound: [], priorityFiles: [] }).prompt, /PRODUCT MEMORY API/)
})

test('task outputs accept the optional memoryApi report', () => {
  const v = { verdicts: [], memoryApi: 'unreachable' }
  assert.equal(parseTaskOutput('validate', [JSON.stringify(v)])?.memoryApi, 'unreachable')
  assert.equal(parseTaskOutput('validate', [JSON.stringify({ verdicts: [] })])?.memoryApi, undefined)
})

test('views filter by query and say whether code changed since the memory', () => {
  assert.ok(matchesQuery('JWT verified with jose', 'jwt JOSE'))
  assert.ok(!matchesQuery('JWT verified with jose', 'jwt session'))
  assert.equal(codeState('abc', 'abc'), 'unchanged')
  assert.equal(codeState('abc', 'def'), 'changed')
  assert.equal(codeState(null, 'def'), 'unknown')

  const facts = formatFacts([{ content: 'Auth uses JWT', evidence: 'src/auth.ts:10', repoId: null, hits: 2 }, { content: 'Data is public', evidence: null, repoId: 1, hits: 0 }], 'jwt')
  assert.match(facts, /1 fact\(s\) matching "jwt"/)
  assert.match(facts, /scope: whole product/)
  assert.doesNotMatch(facts, /public/)

  const verdicts = formatVerdicts(
    [
      { verdict: 'rejected', title: 'SQLi in report filter', file: 'src/r.ts', category: 'code', severity: 'high', reasoning: 'ORM binds it', hash: 'h1', updatedAt: 0 },
      { verdict: 'confirmed', title: 'Open redirect', file: 'src/login.ts', category: 'code', severity: 'medium', reasoning: 'no allowlist', hash: 'h2', updatedAt: 0 },
    ],
    { 'src/r.ts': 'h1', 'src/login.ts': 'zz' },
    { file: 'src/r.ts' },
  )
  assert.match(verdicts, /REJECTED — SQLi in report filter/)
  assert.match(verdicts, /code: unchanged/)
  assert.doesNotMatch(verdicts, /Open redirect/)

  const reviewed = formatReviewed([{ path: 'src/b.ts', hash: 'h', outcome: 'no findings', updatedAt: 0 }, { path: 'lib/a.ts', hash: 'x', outcome: '1 finding(s)', updatedAt: 0 }], { 'src/b.ts': 'h' }, 'src/')
  assert.match(reviewed, /src\/b\.ts\tunchanged\tno findings/)
  assert.doesNotMatch(reviewed, /lib\/a\.ts/)
})

test('probe prompt runs one GET to /ping and never echoes the token', () => {
  const p = probePrompt(api)
  assert.match(p, /OPENSCAN-ROLE: probe/)
  assert.match(p, /https:\/\/openscan\.example\/api\/agent\/ping/)
  assert.match(p, /Never print or repeat the token/)
})

test('settleProbe: a request proves reachability; a finished or stale task without one does not', () => {
  const base = { createdAt: 0, now: 60_000 }
  assert.equal(settleProbe({ ...base, uses: 1, taskStatus: 'in_progress' }), 'reachable')
  assert.equal(settleProbe({ ...base, uses: 0, taskStatus: 'in_progress' }), 'checking')
  assert.equal(settleProbe({ ...base, uses: 0, taskStatus: 'completed' }), 'unreachable')
  assert.equal(settleProbe({ ...base, uses: 0, taskStatus: null, now: 16 * 60_000 }), 'unreachable')
})
