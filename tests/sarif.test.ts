import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sarifFilename, toSarif, type SarifFindingInput, type SarifScanInput } from '../src/lib/sarif.ts'

const SHA = 'a'.repeat(20) + '0123456789abcdef0123'

function scan(over: Partial<SarifScanInput> = {}): SarifScanInput {
  return {
    id: 'scan_1234567890abcdef',
    repo: 'acme/api',
    html_url: 'https://github.com/acme/api',
    commit_sha: SHA,
    status: 'completed',
    created_at: Date.UTC(2026, 0, 2, 3, 4, 5),
    finished_at: Date.UTC(2026, 0, 2, 3, 14, 5),
    engine: 'codex',
    model: 'gpt-x',
    summary: { riskLevel: 'high', headline: 'Two critical issues' },
    ...over,
  }
}

let n = 0
function finding(over: Partial<SarifFindingInput> = {}): SarifFindingInput {
  n++
  return {
    id: `f${String(n).padStart(3, '0')}`,
    severity: 'high',
    category: 'code',
    title: 'SQL injection in search endpoint',
    file: 'src/routes/search.ts',
    line: 42,
    description: 'User input is concatenated into a SQL query.',
    impact: 'Attackers can read arbitrary rows.',
    recommendation: 'Use parameterized queries.',
    confidence: 'high',
    priority: 1,
    status: 'open',
    verdict: null,
    verification: null,
    threat_model: null,
    source: 'hunt',
    fingerprint: `fp-${n}`,
    ...over,
  }
}

const run = (findings: SarifFindingInput[], s = scan()) => toSarif(s, findings).runs[0]

test('log header, driver and run metadata', () => {
  const log = toSarif(scan(), [], { informationUri: 'https://openscan.dev', toolVersion: '1.2.3' })
  assert.equal(log.$schema, 'https://json.schemastore.org/sarif-2.1.0.json')
  assert.equal(log.version, '2.1.0')
  assert.equal(log.runs.length, 1)
  const r = log.runs[0]
  assert.deepEqual(r.tool.driver, { name: 'openscan', version: '1.2.3', informationUri: 'https://openscan.dev', rules: [] })
  assert.deepEqual(r.automationDetails, { id: 'openscan/scan_1234567890abcdef' })
  assert.deepEqual(r.invocations, [
    { executionSuccessful: true, startTimeUtc: '2026-01-02T03:04:05.000Z', endTimeUtc: '2026-01-02T03:14:05.000Z' },
  ])
  assert.deepEqual(r.properties, {
    repository: 'acme/api',
    engine: 'codex',
    model: 'gpt-x',
    riskLevel: 'high',
    headline: 'Two critical issues',
  })

  const bare = run([], scan({ status: 'failed', finished_at: null, engine: null, model: null, summary: null }))
  assert.equal(bare.tool.driver.version, '0.1.0')
  assert.equal('informationUri' in bare.tool.driver, false)
  assert.deepEqual(bare.invocations, [{ executionSuccessful: false, startTimeUtc: '2026-01-02T03:04:05.000Z' }])
  assert.deepEqual(bare.properties, { repository: 'acme/api' })
})

test('level and security-severity mapping', () => {
  const cases: Array<[string, string, string]> = [
    ['critical', 'error', '9.5'],
    ['high', 'error', '8.0'],
    ['medium', 'warning', '5.5'],
    ['low', 'note', '3.0'],
    ['info', 'note', '0.0'],
  ]
  for (const [severity, level, sec] of cases) {
    const r = run([finding({ severity, title: `issue ${severity}` })])
    assert.equal(r.results[0].level, level, severity)
    assert.equal(r.tool.driver.rules[0].defaultConfiguration?.level, level, severity)
    assert.equal(r.tool.driver.rules[0].properties?.['security-severity'], sec, severity)
    assert.deepEqual(r.tool.driver.rules[0].properties?.tags, ['security', 'code'])
  }
})

test('precision derives from confidence, confirmed verdict wins', () => {
  const p = (over: Partial<SarifFindingInput>) => run([finding(over)]).tool.driver.rules[0].properties?.precision
  assert.equal(p({ confidence: 'high' }), 'high')
  assert.equal(p({ confidence: 'medium' }), 'medium')
  assert.equal(p({ confidence: 'low' }), 'low')
  assert.equal(p({ confidence: null }), 'medium')
  assert.equal(p({ confidence: 'weird' }), 'medium')
  assert.equal(p({ confidence: 'low', verdict: 'confirmed' }), 'very-high')
})

test('rules are deduplicated by ruleId and results carry ruleIndex', () => {
  const r = run([
    finding({ title: 'Hardcoded AWS key!', category: 'secret', severity: 'critical', priority: 1, file: 'a.ts' }),
    finding({ title: 'Missing CSRF token', category: 'code', severity: 'medium', priority: 2 }),
    finding({ title: 'hardcoded  aws KEY', category: 'secret', severity: 'critical', priority: 3, file: 'b.ts' }),
  ])
  assert.deepEqual(
    r.tool.driver.rules.map((x) => x.id),
    ['openscan/secret/hardcoded-aws-key', 'openscan/code/missing-csrf-token'],
  )
  assert.deepEqual(
    r.results.map((x) => [x.ruleId, x.ruleIndex]),
    [
      ['openscan/secret/hardcoded-aws-key', 0],
      ['openscan/secret/hardcoded-aws-key', 0],
      ['openscan/code/missing-csrf-token', 1],
    ],
  )
  for (const res of r.results) assert.equal(r.tool.driver.rules[res.ruleIndex].id, res.ruleId)
  // first finding's metadata wins
  assert.equal(r.tool.driver.rules[0].shortDescription?.text, 'Hardcoded AWS key!')
  assert.equal(r.tool.driver.rules[0].name, 'HardcodedAwsKey')
  assert.deepEqual(r.tool.driver.rules[0].help, { text: 'Use parameterized queries.' })
})

test('ruleId slug is lowercase, trimmed and capped at 64 chars', () => {
  const r = run([finding({ title: '  --' + 'Very Long Title '.repeat(10) + '!!' })])
  const slugPart = r.results[0].ruleId.split('/')[2]
  assert.ok(slugPart.length <= 64)
  assert.match(slugPart, /^[a-z0-9]+(-[a-z0-9]+)*$/)
  assert.ok(slugPart.startsWith('very-long-title'))
})

test('rule help omitted without recommendation; long description truncated', () => {
  const r = run([finding({ recommendation: null, description: 'word '.repeat(1000) })])
  const rule = r.tool.driver.rules[0]
  assert.equal('help' in rule, false)
  assert.ok(rule.fullDescription!.text.length <= 1000)
  assert.ok(rule.fullDescription!.text.endsWith('…'))
})

test('message text includes title, description and impact', () => {
  const r = run([finding(), finding({ impact: null, title: 'Other' })])
  assert.equal(
    r.results[0].message.text,
    'SQL injection in search endpoint\n\nUser input is concatenated into a SQL query.\n\nImpact: Attackers can read arbitrary rows.',
  )
  assert.equal(r.results[1].message.text, 'Other\n\nUser input is concatenated into a SQL query.')
})

test('locations omitted without file; region omitted without valid line', () => {
  const r = run([
    finding({ file: null, priority: 1 }),
    finding({ file: '', priority: 2 }),
    finding({ file: 'src/x.ts', line: null, priority: 3 }),
    finding({ file: 'src/y.ts', line: 0, priority: 4 }),
    finding({ file: 'src/z.ts', line: 2.5, priority: 5 }),
    finding({ file: 'src/w.ts', line: 7, priority: 6 }),
  ])
  assert.equal('locations' in r.results[0], false)
  assert.equal('locations' in r.results[1], false)
  assert.deepEqual(r.results[2].locations, [{ physicalLocation: { artifactLocation: { uri: 'src/x.ts' } } }])
  assert.equal('region' in r.results[3].locations![0].physicalLocation, false)
  assert.equal('region' in r.results[4].locations![0].physicalLocation, false)
  assert.deepEqual(r.results[5].locations![0].physicalLocation.region, { startLine: 7 })
})

test('artifact uri is relative and percent-encoded per segment', () => {
  const uri = (file: string) => run([finding({ file })]).results[0].locations![0].physicalLocation.artifactLocation.uri
  assert.equal(uri('./my dir/some file#1.ts'), 'my%20dir/some%20file%231.ts')
  assert.equal(uri('/src/app.ts'), 'src/app.ts')
  assert.equal(uri('src/100%/ü.ts'), 'src/100%25/%C3%BC.ts')
})

test('partial fingerprint and result properties (nulls omitted)', () => {
  const r = run([
    finding({ fingerprint: 'abc123', threat_model: 'remote attacker', verdict: 'confirmed', source: null, priority: null }),
  ])
  const res = r.results[0]
  assert.deepEqual(res.partialFingerprints, { 'openscanFingerprint/v1': 'abc123' })
  assert.deepEqual(res.properties, {
    severity: 'high',
    category: 'code',
    confidence: 'high',
    verdict: 'confirmed',
    threatModel: 'remote attacker',
    findingId: res.properties!.findingId,
  })
  assert.equal(typeof res.properties!.findingId, 'string')
})

test('suppressions for dismissed, fixed and rejected findings', () => {
  const r = run([
    finding({ id: 'a', status: 'open', priority: 1 }),
    finding({ id: 'b', status: 'open', verdict: 'rejected', priority: 2 }),
    finding({ id: 'c', status: 'open', verdict: 'rejected', verification: 'Input is validated upstream', priority: 3 }),
    finding({ id: 'd', status: 'dismissed', priority: 4 }),
    finding({ id: 'e', status: 'dismissed', verification: 'Test fixture only', priority: 5 }),
    finding({ id: 'f', status: 'fixed', verification: 'ignored', priority: 6 }),
  ])
  const byId = Object.fromEntries(r.results.map((x) => [x.properties!.findingId, x]))
  assert.equal('suppressions' in byId.a, false)
  assert.deepEqual(byId.b.suppressions, [
    { kind: 'external', status: 'accepted', justification: 'Rejected by the independent validator' },
  ])
  assert.deepEqual(byId.c.suppressions, [{ kind: 'external', status: 'accepted', justification: 'Input is validated upstream' }])
  assert.deepEqual(byId.d.suppressions, [{ kind: 'external', status: 'accepted', justification: 'Dismissed in openscan' }])
  assert.deepEqual(byId.e.suppressions, [{ kind: 'external', status: 'accepted', justification: 'Test fixture only' }])
  assert.deepEqual(byId.f.suppressions, [{ kind: 'external', status: 'accepted', justification: 'Marked fixed in openscan' }])
})

test('results ordered: open first, then severity, then priority (null last)', () => {
  const input = [
    finding({ id: 'low-open', severity: 'low', priority: 1, title: 't1' }),
    finding({ id: 'crit-dismissed', severity: 'critical', priority: 1, status: 'dismissed', title: 't2' }),
    finding({ id: 'high-null', severity: 'high', priority: null, title: 't3' }),
    finding({ id: 'high-p2', severity: 'high', priority: 2, title: 't4' }),
    finding({ id: 'crit-open', severity: 'critical', priority: 9, title: 't5' }),
    finding({ id: 'high-p1', severity: 'high', priority: 1, title: 't6' }),
    finding({ id: 'info-fixed', severity: 'info', priority: 1, status: 'fixed', title: 't7' }),
  ]
  const order = (fs: SarifFindingInput[]) => run(fs).results.map((x) => x.properties!.findingId)
  const expected = ['crit-open', 'high-p1', 'high-p2', 'high-null', 'low-open', 'crit-dismissed', 'info-fixed']
  assert.deepEqual(order(input), expected)
  // deterministic regardless of input order
  assert.deepEqual(order([...input].reverse()), expected)
  assert.equal(JSON.stringify(toSarif(scan(), input)), JSON.stringify(toSarif(scan(), [...input].reverse())))
})

test('revisionId only for a 40-hex commit sha; repositoryUri falls back to github', () => {
  assert.deepEqual(run([]).versionControlProvenance, [{ repositoryUri: 'https://github.com/acme/api', revisionId: SHA }])
  assert.deepEqual(run([], scan({ commit_sha: SHA.toUpperCase() })).versionControlProvenance[0].revisionId, SHA.toUpperCase())
  for (const commit_sha of [null, 'main', SHA.slice(0, 7), SHA + 'a', 'g'.repeat(40)]) {
    const p = run([], scan({ commit_sha, html_url: null })).versionControlProvenance
    assert.deepEqual(p, [{ repositoryUri: 'https://github.com/acme/api' }], String(commit_sha))
  }
})

test('output contains no undefined values', () => {
  const log = toSarif(
    scan({ html_url: null, commit_sha: null, finished_at: null, engine: null, model: null, summary: {} }),
    [
      finding({ file: null, line: null, impact: null, recommendation: null, confidence: null, priority: null, source: null }),
      finding({ status: 'dismissed', verdict: 'rejected' }),
    ],
  )
  const walk = (v: unknown, path: string) => {
    assert.notEqual(v, undefined, path)
    if (v && typeof v === 'object') for (const [k, c] of Object.entries(v)) walk(c, `${path}.${k}`)
  }
  walk(log, '$')
  assert.deepEqual(JSON.parse(JSON.stringify(log)), log)
})

test('sarifFilename is filesystem-safe', () => {
  assert.equal(sarifFilename({ id: 'abcdef1234567890', repo: 'Owner/Name' }), 'openscan-owner-name-abcdef12.sarif')
  assert.equal(sarifFilename({ id: 'x', repo: 'my.org/repo.js' }), 'openscan-my.org-repo.js-x.sarif')
  for (const s of [
    { id: '../../etc/passwd', repo: '../../evil/<x>:"|?*' },
    { id: '', repo: '' },
    { id: 'id with spaces', repo: 'a b/c\\d' },
    { id: '1234', repo: '.../...' },
  ]) {
    const name = sarifFilename(s)
    assert.match(name, /^openscan-[a-z0-9][a-z0-9._-]*\.sarif$/, name)
    assert.equal(name.includes('..'), false, name)
    assert.equal(name.includes('/'), false, name)
  }
})
