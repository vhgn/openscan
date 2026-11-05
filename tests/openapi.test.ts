import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SPEC_PATH, coverageProblems, renderSpec } from '../scripts/generate-openapi.ts'
import { StartScanBody } from '../src/lib/api/contract.ts'

test('every API route file is in the OpenAPI contract', () => {
  assert.deepEqual(coverageProblems(), [])
})

test('public/openapi.json is up to date (run npm run generate)', () => {
  assert.equal(readFileSync(SPEC_PATH, 'utf8'), renderSpec())
})

test('POST /api/scans body: productId, repo name or repoId; kind defaults to security', () => {
  assert.deepEqual(StartScanBody.parse({ productId: 'p1' }), { productId: 'p1' })
  assert.deepEqual(StartScanBody.parse({ repo: 'OWASP/NodeGoat' }), { repo: 'OWASP/NodeGoat', kind: 'security' })
  assert.deepEqual(StartScanBody.parse({ repoId: -12, kind: 'understand' }), { repoId: -12, kind: 'understand' })
  assert.equal(StartScanBody.safeParse({}).success, false)
  assert.equal(StartScanBody.safeParse({ repo: 'x', kind: 'deep' }).success, false)
})
