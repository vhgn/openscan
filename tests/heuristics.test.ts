import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heuristicFindings, heuristicProfile, heuristicQuestions } from '../src/lib/scanner/heuristics.ts'

test('detects committed AWS keys with line numbers', () => {
  const f = heuristicFindings('config.js', 'const a = 1\nconst key = "AKIAABCDEFGHIJKLMNOP"\n')
  const aws = f.find((x) => x.title.includes('AWS'))
  assert.ok(aws)
  assert.equal(aws.severity, 'critical')
  assert.equal(aws.line, 2)
})

test('flags pull_request_target only in workflow files', () => {
  assert.equal(heuristicFindings('.github/workflows/ci.yml', 'on: pull_request_target').length, 1)
  assert.equal(heuristicFindings('docs/notes.md', 'on: pull_request_target').length, 0)
})

test('clean code yields no findings', () => {
  assert.deepEqual(heuristicFindings('src/sum.ts', 'export const sum = (a: number, b: number) => a + b\n'), [])
})

test('profile + questions infer basics from the tree', () => {
  const paths = ['package.json', 'Dockerfile', 'src/auth/login.ts', 'src/index.ts']
  const p = heuristicProfile(paths, { 'package.json': '{"dependencies":{"express":"4","pg":"8"}}' }, '# Acme API\nPayments backend')
  assert.ok(p.stack.includes('Express'))
  assert.ok(p.dataStores.includes('PostgreSQL'))
  assert.match(p.deployment, /Container/)
  const qs = heuristicQuestions(paths)
  assert.ok(qs.some((q) => q.answer && q.evidence === 'Dockerfile'))
  assert.ok(qs.some((q) => !q.answer))
})
