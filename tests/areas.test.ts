import { test } from 'node:test'
import assert from 'node:assert/strict'
import { areasFor } from '../src/lib/scanner/areas.ts'

test('dependency advisory on an auth library is both Auth and Dependencies', () => {
  assert.deepEqual(
    areasFor({ category: 'dependency', source: 'osv', title: 'better-auth@1.4.15 has 13 known vulnerabilities', file: 'apps/backend/package.json' }),
    ['auth', 'dependencies'],
  )
})

test('Stripe webhook signature finding is Payments and Web & API', () => {
  const a = areasFor({ category: 'code', title: 'Forged Stripe webhooks can mark invoices as paid', file: 'src/billing/webhook.ts' })
  assert.ok(a.includes('payments'))
  assert.ok(a.includes('web'))
})

test('SQL injection is Data', () => {
  assert.deepEqual(areasFor({ category: 'code', title: 'SQL injection in report export', file: 'server/reports.js' }), ['data'])
})

test('workflow files are CI/CD, Dockerfiles and runtime advisories are Infrastructure', () => {
  assert.ok(areasFor({ category: 'code', title: 'Untrusted input in run step', file: '.github/workflows/ci.yml' }).includes('ci'))
  assert.ok(areasFor({ category: 'config', title: 'Node.js 12 is end-of-life', file: 'Dockerfile', source: 'runtime-advisory' }).includes('infra'))
})

test('auth detected from the file path alone', () => {
  assert.ok(areasFor({ category: 'code', title: 'Missing check', file: 'src/auth/session.ts' }).includes('auth'))
})

test('hardcoded secret is Secrets, unrelated text gets no area', () => {
  assert.deepEqual(areasFor({ category: 'secret', title: 'Hardcoded API key' }), ['secrets'])
  assert.deepEqual(areasFor({ category: 'code', title: 'Integer overflow in counter', file: 'lib/math.c' }), [])
})
