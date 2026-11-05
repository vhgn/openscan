import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRepoId, parseRepoRef } from '../src/lib/github/repo-ref.ts'

test('repository refs: owner/name and the GitHub links people paste', () => {
  for (const input of [
    'OWASP/NodeGoat',
    '  OWASP/NodeGoat  ',
    'github.com/OWASP/NodeGoat',
    'https://github.com/OWASP/NodeGoat',
    'https://www.github.com/OWASP/NodeGoat/',
    'https://github.com/OWASP/NodeGoat.git',
    'https://github.com/OWASP/NodeGoat/tree/master/app',
    'https://github.com/OWASP/NodeGoat?tab=readme#top',
    'git@github.com:OWASP/NodeGoat.git',
    'ssh://git@github.com/OWASP/NodeGoat.git',
  ]) {
    assert.equal(parseRepoRef(input), 'OWASP/NodeGoat', input)
  }
  assert.equal(parseRepoRef('vercel/next.js'), 'vercel/next.js')
  assert.equal(parseRepoRef('a-b/c_d.e-f'), 'a-b/c_d.e-f')
})

test('repository refs: rejects what is not a GitHub repository', () => {
  for (const input of ['', 'NodeGoat', 'owner/', '/name', 'owner/..', '-owner/name', 'own--er/name', 'owner/na me', 'https://gitlab.com/owner/name', 'owner/name;rm -rf', `${'a'.repeat(40)}/x`]) {
    assert.equal(parseRepoRef(input), null, input)
  }
})

test('repository ids: numeric strings only', () => {
  assert.equal(parseRepoId('123'), 123)
  assert.equal(parseRepoId('-456'), -456)
  assert.equal(parseRepoId('owner/name'), null)
  assert.equal(parseRepoId('12a'), null)
})
