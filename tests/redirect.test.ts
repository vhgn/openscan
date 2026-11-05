import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeNextPath } from '../src/lib/redirect.ts'

test('post-login next paths must be same-origin relative', () => {
  assert.equal(safeNextPath('/settings'), '/settings')
  assert.equal(safeNextPath('/scans/abc?tab=findings'), '/scans/abc?tab=findings')
  assert.equal(safeNextPath(null), null)
  assert.equal(safeNextPath('//evil.example'), null)
  assert.equal(safeNextPath('/\\evil.example'), null)
  assert.equal(safeNextPath('https://evil.example'), null)
  assert.equal(safeNextPath('/x\r\nSet-Cookie: a=b'), null)
})
