import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupeDeps, parseDeps } from '../src/lib/scanner/deps.ts'

test('parses package-lock v2/v3 packages including nested', () => {
  const lock = JSON.stringify({
    packages: {
      '': { version: '1.0.0' },
      'node_modules/lodash': { version: '4.17.20' },
      'node_modules/a/node_modules/@scope/b': { version: '2.0.0' },
    },
  })
  const deps = parseDeps('package-lock.json', lock)
  assert.deepEqual(
    deps.map((d) => `${d.name}@${d.version}`),
    ['lodash@4.17.20', '@scope/b@2.0.0'],
  )
})

test('package.json only yields exact-ish versions', () => {
  const deps = parseDeps('package.json', JSON.stringify({ dependencies: { a: '^1.2.3', b: 'latest', c: '>=2' } }))
  assert.deepEqual(deps.map((d) => d.name), ['a'])
})

test('parses requirements.txt, go.mod, Gemfile.lock, Cargo.lock', () => {
  assert.equal(parseDeps('requirements.txt', 'Django==3.2.1\nrequests>=2\nflask[async]==2.0.0').length, 2)
  assert.equal(parseDeps('go.mod', 'module x\nrequire (\n\tgithub.com/gin-gonic/gin v1.7.0\n)\n')[0]?.name, 'github.com/gin-gonic/gin')
  assert.equal(parseDeps('Gemfile.lock', 'GEM\n  specs:\n    rails (6.1.0)\n')[0]?.version, '6.1.0')
  assert.equal(parseDeps('Cargo.lock', '[[package]]\nname = "serde"\nversion = "1.0.100"\n')[0]?.ecosystem, 'crates.io')
})

test('malformed manifests do not throw', () => {
  assert.deepEqual(parseDeps('package-lock.json', '{not json'), [])
})

test('dedupeDeps removes duplicates and caps', () => {
  const d = { ecosystem: 'npm' as const, name: 'a', version: '1.0.0', file: 'x' }
  assert.equal(dedupeDeps([d, d, { ...d, version: '2.0.0' }]).length, 2)
  assert.equal(dedupeDeps([d, { ...d, name: 'b' }], 1).length, 1)
})
