#!/usr/bin/env node
/**
 * End-to-end demo of the REST API against a local dev server (no browser needed):
 *   sign in (demo mode) → POST /api/scans {repo} → follow /progress → print the brief → SARIF.
 *
 *   npm run demo                                   # OWASP/NodeGoat
 *   npm run demo -- https://github.com/juice-shop/juice-shop
 *   npm run demo -- owner/repo --base http://localhost:3000
 *
 * Needs `npm run dev` running with DEV_DEMO_LOGIN=1 in .dev.vars (see README "Reviewer quick path").
 * Node 22+, no dependencies.
 */
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  if (i === -1) return fallback
  const [, value] = args.splice(i, 2)
  return value
}
const base = flag('--base', process.env.OPENSCAN_URL || 'http://localhost:3000').replace(/\/+$/, '')
const repoUrl = args[0] || 'https://github.com/OWASP/NodeGoat'

const dim = (s) => `\x1b[2m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const die = (msg) => {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

let cookie = ''
async function api(path, init = {}) {
  const res = await fetch(base + path, { redirect: 'manual', ...init, headers: { cookie, ...init.headers } })
  const text = res.status === 304 ? '' : await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { res, body }
}

// 1. Sign in. Demo mode creates a fake GitHub user; the session is a normal cookie.
console.log(bold(`openscan demo → ${base}`))
let login
try {
  login = await fetch(`${base}/api/dev/login?repos=`, { redirect: 'manual' })
} catch {
  die(`Cannot reach ${base}. Start the app first: npm run dev`)
}
if (login.status === 404) die('Demo login is off. Add DEV_DEMO_LOGIN=1 to .dev.vars and restart `npm run dev`.')
cookie = (login.headers.getSetCookie?.() ?? [login.headers.get('set-cookie')]).filter(Boolean).map((c) => c.split(';')[0]).join('; ')
if (!cookie) die(`Login did not set a session cookie (HTTP ${login.status}).`)
console.log(`${dim('1.')} Signed in as the demo user`)

// 2. Start a scan from a URL. Sending the same request again is safe: you get the running scan back.
const start = await api('/api/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repo: repoUrl }) })
if (start.res.status >= 400) die(`POST /api/scans → ${start.res.status} ${JSON.stringify(start.body)}`)
const scan = start.body
console.log(`${dim('2.')} POST /api/scans {"repo":"${repoUrl}"} → ${start.res.status} ${scan.existing ? '(already running, reused)' : '(queued)'}`)
console.log(`   scan ${scan.id} · ${scan.repo} · ${base}${scan.url}`)
const again = await api('/api/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repo: repoUrl }) })
console.log(dim(`   same POST again → ${again.res.status}, existing=${again.body?.existing}, same id=${again.body?.id === scan.id}`))

// 3. Follow progress: only new log lines (cursor), and 304s while nothing changed (ETag).
console.log(`${dim('3.')} Following GET /api/scans/${scan.id}/progress`)
let since = 0
let etag = ''
let notModified = 0
let progress
const deadline = Date.now() + 15 * 60_000
for (;;) {
  const r = await api(`/api/scans/${scan.id}/progress?since=${since}`, { headers: etag ? { 'if-none-match': etag } : {} })
  if (r.res.status === 304) notModified++
  else if (r.res.ok) {
    etag = r.res.headers.get('etag') || ''
    progress = r.body
    for (const e of progress.events) console.log(`   ${e.level === 'info' ? '' : `[${e.level}] `}${e.message}`)
    if (progress.live) console.log(dim(`   … ${progress.phase} · ${progress.progress}%`))
    since = progress.cursor
    if (!progress.live) break
  } else die(`progress → ${r.res.status} ${JSON.stringify(r.body)}`)
  if (Date.now() > deadline) die('Gave up after 15 minutes. The scan is still running; open it in the browser.')
  await sleep(1500)
}
console.log(dim(`   ${notModified} poll(s) answered 304 Not Modified`))
if (progress.status !== 'completed') die(`Scan ${progress.status}${progress.error ? `: ${progress.error}` : ''}`)

// 4. The brief.
const { body: detail } = await api(`/api/scans/${scan.id}`)
const s = detail.scan.summary ?? {}
console.log(`\n${dim('4.')} ${bold(s.headline ?? 'Scan complete')}`)
if (s.riskLevel) console.log(`   Overall risk: ${s.riskLevel}`)
if (s.whatMatters?.length) {
  console.log(bold('\n   What matters'))
  for (const m of s.whatMatters) console.log(`   – ${m}`)
}
if (s.nextActions?.length) {
  console.log(bold('\n   What to do next'))
  s.nextActions.forEach((a, i) => console.log(`   ${i + 1}. ${a.action} ${dim(`(${a.effort})`)}`))
}
const open = detail.findings.filter((f) => f.status === 'open')
console.log(bold(`\n   Top findings (${open.length} open)`))
for (const f of open.slice(0, 5)) console.log(`   ${f.severity.toUpperCase().padEnd(8)} ${f.title}${f.file ? dim(`  ${f.file}${f.line ? `:${f.line}` : ''}`) : ''}`)

// 5. SARIF export.
const sarif = await api(`/api/scans/${scan.id}/sarif`)
if (!sarif.res.ok) die(`SARIF → ${sarif.res.status}`)
console.log(`\n${dim('5.')} GET /api/scans/${scan.id}/sarif → ${sarif.body.runs[0].results.length} results, ${sarif.body.runs[0].tool.driver.rules.length} rules (SARIF ${sarif.body.version})`)
console.log(`\nFull report: ${base}${scan.url}`)
