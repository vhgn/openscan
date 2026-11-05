import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scorePath, selectFiles, selectLockfiles, treeOverview } from '../src/lib/scanner/select-files.ts'

const opts = { maxFiles: 5, maxBytesPerFile: 14_000 }

test('skips vendored, binary and lock files', () => {
  assert.equal(scorePath('node_modules/x/index.js', 10, opts), -1)
  assert.equal(scorePath('assets/logo.png', 10, opts), -1)
  assert.equal(scorePath('package-lock.json', 10, opts), -1)
  assert.equal(scorePath('dist/app.js', 10, opts), -1)
})

test('ranks security-relevant files above generic code and tests', () => {
  const entries = [
    { path: 'src/utils/format.ts', type: 'blob' as const, size: 100 },
    { path: 'src/auth/session.ts', type: 'blob' as const, size: 100 },
    { path: 'package.json', type: 'blob' as const, size: 100 },
    { path: 'src/auth/session.test.ts', type: 'blob' as const, size: 100 },
    { path: '.github/workflows/ci.yml', type: 'blob' as const, size: 100 },
    { path: 'README.md', type: 'blob' as const, size: 100 },
  ]
  const picked = selectFiles(entries, opts)
  assert.equal(picked.length, 5)
  assert.ok(picked.indexOf('src/auth/session.ts') < picked.indexOf('src/utils/format.ts'))
  assert.ok(!picked.includes('src/auth/session.test.ts'))
})

test('boost paths from the repo profile get priority', () => {
  const a = scorePath('lib/billing/charge.ts', 100, opts)
  const b = scorePath('lib/billing/charge.ts', 100, { ...opts, boost: ['billing'] })
  assert.ok(b > a)
})

test('selectLockfiles prefers shallow manifests', () => {
  const picked = selectLockfiles([
    { path: 'packages/a/package-lock.json', type: 'blob', size: 1 },
    { path: 'package-lock.json', type: 'blob', size: 1 },
    { path: 'node_modules/x/package.json', type: 'blob', size: 1 },
  ])
  assert.deepEqual(picked, ['package-lock.json', 'packages/a/package-lock.json'])
})

test('treeOverview summarises directories', () => {
  const o = treeOverview([
    { path: 'src/a/x.ts', type: 'blob' },
    { path: 'src/a/y.ts', type: 'blob' },
    { path: 'README.md', type: 'blob' },
  ])
  assert.match(o, /src\/a\/ \(2 files\)/)
})
