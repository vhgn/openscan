import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { pemToPkcs8 } from '../src/lib/github/pem.ts'
import { extractJson } from '../src/lib/ai/llm.ts'

test('PKCS#1 GitHub keys are converted to importable PKCS#8', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pkcs1 = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
  const expected = privateKey.export({ type: 'pkcs8', format: 'der' })
  const der = pemToPkcs8(pkcs1.replace(/\n/g, '\\n')) // env vars often carry literal \n
  assert.deepEqual(Buffer.from(der), Buffer.from(expected))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  assert.equal(key.type, 'private')
})

test('extractJson tolerates fences and prose', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(extractJson('result: {"b":[1,2]} done'), { b: [1, 2] })
  assert.throws(() => extractJson('no json here'))
})
