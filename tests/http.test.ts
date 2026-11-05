import { test } from 'node:test'
import assert from 'node:assert/strict'
import { etagFor, etagMatches, jsonWithEtag } from '../src/lib/http.ts'

test('etag is stable for identical bodies and differs otherwise', async () => {
  assert.equal(await etagFor('{"a":1}'), await etagFor('{"a":1}'))
  assert.notEqual(await etagFor('{"a":1}'), await etagFor('{"a":2}'))
  assert.match(await etagFor('x'), /^W\/"[0-9a-f]{32}"$/)
})

test('If-None-Match uses weak comparison and accepts lists and *', () => {
  assert.ok(etagMatches('W/"abc"', 'W/"abc"'))
  assert.ok(etagMatches('"abc"', 'W/"abc"'))
  assert.ok(etagMatches('"zzz", W/"abc"', 'W/"abc"'))
  assert.ok(etagMatches('*', 'W/"abc"'))
  assert.ok(!etagMatches('W/"abd"', 'W/"abc"'))
  assert.ok(!etagMatches(null, 'W/"abc"'))
})

test('jsonWithEtag answers 304 with no body when the client is current', async () => {
  const data = { status: 'running', progress: 40 }
  const first = await jsonWithEtag(new Request('https://x/api'), data)
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), data)
  const etag = first.headers.get('etag')!
  const again = await jsonWithEtag(new Request('https://x/api', { headers: { 'if-none-match': etag } }), data)
  assert.equal(again.status, 304)
  assert.equal(await again.text(), '')
  assert.equal(again.headers.get('etag'), etag)
  const changed = await jsonWithEtag(new Request('https://x/api', { headers: { 'if-none-match': etag } }), { ...data, progress: 41 })
  assert.equal(changed.status, 200)
})
