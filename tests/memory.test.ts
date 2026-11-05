import { test } from 'node:test'
import assert from 'node:assert/strict'
import { factKey, priorVerdict, reviewTtlDays, sameClaim, similarQuestion, titleSimilarity } from '../src/lib/memory-match.ts'

test('titleSimilarity tolerates LLM rewording of the same issue', () => {
  assert.ok(titleSimilarity('SQL injection in report filter query', 'Report filter query is vulnerable to SQL injection') >= 0.5)
  assert.ok(titleSimilarity('Stripe webhook signature not verified', 'Missing CSRF protection on settings form') < 0.2)
  assert.equal(titleSimilarity('', 'anything'), 0)
})

test('sameClaim requires same file and category', () => {
  const a = { title: 'Unvalidated redirect in login handler', file: 'src/login.ts', category: 'code' }
  assert.ok(sameClaim(a, { ...a, title: 'Login handler has an unvalidated redirect' }))
  assert.ok(!sameClaim(a, { ...a, file: 'src/logout.ts' }))
  assert.ok(!sameClaim(a, { ...a, category: 'config' }))
})

test('factKey normalises punctuation/case so facts dedupe', () => {
  assert.equal(factKey('Auth: JWT via `jose`!'), factKey('auth  jwt via jose'))
})

test('deep scans re-review sooner', () => {
  assert.ok(reviewTtlDays('deep_poc') < reviewTtlDays('standard'))
})

test('priorVerdict reuses a verdict only for the same claim on identical code', () => {
  const mem = [{ id: 'm1', verdict: 'rejected', title: 'SQL injection in report filter', file: 'src/reports.ts', category: 'code', severity: 'high', reasoning: 'ORM binds the value', hash: 'abc' }]
  const claim = { title: 'Report filter allows SQL injection', file: 'src/reports.ts', category: 'code' }
  assert.equal(priorVerdict(mem, claim, 'abc')?.id, 'm1')
  assert.equal(priorVerdict(mem, claim, 'def'), null, 'code changed → re-validate')
  assert.equal(priorVerdict(mem, claim, null), null)
  assert.equal(priorVerdict(mem, { ...claim, title: 'Hardcoded AWS key' }, 'abc'), null)
})

test('similarQuestion catches rewordings of skipped questions only', () => {
  const skipped = ['Is this application reachable from the public internet?', 'Which ORM version does the API use?']
  assert.equal(similarQuestion('Is the app reachable from the internet?', skipped), true)
  assert.equal(similarQuestion('Is the API publicly reachable from the internet?', skipped), true)
  assert.equal(similarQuestion('What ORM version is used by the API?', skipped), true)
  assert.equal(similarQuestion('Does it store payment card data or other PII?', skipped), false)
  assert.equal(similarQuestion('Is there an admin role separate from normal users?', skipped), false)
  assert.equal(similarQuestion('anything', []), false)
})
