#!/usr/bin/env node
/**
 * `npm run setup`: everything a local run needs, safe to re-run any time
 * (for example after pulling new migrations).
 *
 *   1. Creates .dev.vars from .dev.vars.example if it doesn't exist.
 *   2. Fills in generated secrets that are missing or still placeholders
 *      (SESSION_SECRET, LWC_SECRET, GITHUB_WEBHOOK_SECRET).
 *   3. Checks the GitHub App credentials, and when they are all there, signs an
 *      app JWT and asks GitHub who the app is (fills GITHUB_APP_SLUG for you).
 *   4. Applies the D1 migrations to the local database (no Cloudflare account needed).
 *
 * Flags:
 *   --demo     no GitHub App: enable demo sign-in (DEV_DEMO_LOGIN=1) instead of failing
 *   --offline  skip the call to GitHub that verifies the app credentials
 *
 * How to create the GitHub credentials: docs/github-app.md
 */
import { createPrivateKey, createSign, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const VARS = join(root, '.dev.vars')
const EXAMPLE = join(root, '.dev.vars.example')
const DOC = 'docs/github-app.md'
const args = new Set(process.argv.slice(2))
const demo = args.has('--demo')
const offline = args.has('--offline')

const color = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s)
const green = color(32)
const yellow = color(33)
const red = color(31)
const bold = color(1)
const ok = (msg) => console.log(`${green('✓')} ${msg}`)
const warn = (msg) => console.log(`${yellow('!')} ${msg}`)
const bad = (msg) => console.log(`${red('✗')} ${msg}`)

// ---------------------------------------------------------------- .dev.vars

/** KEY=VALUE lines; a double-quoted value may span several lines (the PEM). Comments are kept as-is. */
function parseVars(text) {
  const lines = text.split('\n')
  const entries = [] // { key, value, start, end } (line indexes, inclusive)
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(lines[i])
    if (!m) continue
    let raw = m[2]
    const start = i
    if (raw.startsWith('"') && !(raw.length > 1 && raw.endsWith('"'))) {
      while (i + 1 < lines.length && !lines[i].endsWith('"')) raw += `\n${lines[++i]}`
    }
    const value = raw.startsWith('"') && raw.endsWith('"') && raw.length > 1 ? raw.slice(1, -1) : raw.replace(/\s+#.*$/, '').trim()
    entries.push({ key: m[1], value, start, end: i })
  }
  return { lines, entries, get: (k) => entries.findLast((e) => e.key === k)?.value ?? '' }
}

function setVar(text, key, value) {
  const { lines, entries } = parseVars(text)
  const line = `${key}=${/[\s#"\n]/.test(value) ? JSON.stringify(value) : value}`
  const found = entries.findLast((e) => e.key === key)
  if (found) lines.splice(found.start, found.end - found.start + 1, line)
  else {
    // Uncomment "# KEY=" if the example has it, otherwise append.
    const commented = lines.findIndex((l) => new RegExp(`^#\\s*${key}=`).test(l))
    if (commented >= 0) lines[commented] = line
    else lines.push(line)
  }
  return lines.join('\n')
}

const example = existsSync(EXAMPLE) ? parseVars(readFileSync(EXAMPLE, 'utf8')) : null
/** Unset, copied unchanged from .dev.vars.example, or an obvious placeholder. */
function isPlaceholder(key, value) {
  if (!value) return true
  if (example && example.get(key) === value) return true
  return /replace-me|XXXXXXXX|xxxxxxxx|\\n\.\.\.\\n|\n\.\.\.\n/.test(value)
}

console.log(bold('openscan local setup\n'))

if (!existsSync(VARS)) {
  copyFileSync(EXAMPLE, VARS)
  ok('Created .dev.vars from .dev.vars.example')
}
let vars = readFileSync(VARS, 'utf8')
const v = () => parseVars(vars)

// ---------------------------------------------------------------- generated secrets

for (const key of ['SESSION_SECRET', 'LWC_SECRET', 'GITHUB_WEBHOOK_SECRET']) {
  if (isPlaceholder(key, v().get(key))) {
    vars = setVar(vars, key, randomBytes(32).toString('hex'))
    ok(`Generated ${key}`)
  } else ok(`${key} is set`)
}

// ---------------------------------------------------------------- GitHub App

const GITHUB_KEYS = {
  GITHUB_APP_ID: (s) => /^\d+$/.test(s) || 'should be the numeric App ID',
  GITHUB_CLIENT_ID: (s) => /^Iv[0-9A-Za-z.]+$/.test(s) || 'should look like Iv23li…',
  GITHUB_CLIENT_SECRET: (s) => s.length >= 20 || 'looks too short',
  GITHUB_APP_PRIVATE_KEY: (s) => /-----BEGIN (RSA )?PRIVATE KEY-----/.test(s) || 'should be the PEM file contents',
}
const pem = () => v().get('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n')
const problems = []
for (const [key, check] of Object.entries(GITHUB_KEYS)) {
  const value = key === 'GITHUB_APP_PRIVATE_KEY' ? pem() : v().get(key)
  if (isPlaceholder(key, v().get(key))) problems.push(`${key} is missing`)
  else if (check(value) !== true) problems.push(`${key} ${check(value)}`)
}

let githubReady = problems.length === 0
if (githubReady) {
  try {
    createPrivateKey(pem())
  } catch (e) {
    problems.push(`GITHUB_APP_PRIVATE_KEY can't be read (${e.message})`)
    githubReady = false
  }
}

if (githubReady && !offline) {
  try {
    const app = await whoAmI(v().get('GITHUB_APP_ID'), pem())
    ok(`GitHub App "${app.name}" (${app.html_url}) accepted the App ID and private key`)
    if (app.client_id && app.client_id !== v().get('GITHUB_CLIENT_ID')) {
      problems.push(`GITHUB_CLIENT_ID is ${v().get('GITHUB_CLIENT_ID')} but the app's client ID is ${app.client_id}`)
      githubReady = false
    }
    if (app.slug && v().get('GITHUB_APP_SLUG') !== app.slug) {
      vars = setVar(vars, 'GITHUB_APP_SLUG', app.slug)
      ok(`Set GITHUB_APP_SLUG=${app.slug}`)
    }
  } catch (e) {
    if (e.status === 401 || e.status === 404) {
      problems.push(`GitHub rejected GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY (${e.message})`)
      githubReady = false
    } else warn(`Couldn't reach GitHub to verify the app (${e.message}); continuing`)
  }
} else if (githubReady) warn('--offline: skipped verifying the app with GitHub')

if (githubReady) ok('GitHub App credentials are set')
if (demo) {
  if (v().get('DEV_DEMO_LOGIN') !== '1') vars = setVar(vars, 'DEV_DEMO_LOGIN', '1')
  ok('Demo sign-in enabled (DEV_DEMO_LOGIN=1): http://localhost:3000/api/dev/login?repos=OWASP/NodeGoat')
}

writeFileSync(VARS, vars)

// ---------------------------------------------------------------- local database

try {
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'openscan', '--local'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: 'true' }, // non-interactive: no "Ok to proceed?" prompt
  })
  ok('Local D1 database is migrated (.wrangler/state)')
} catch (e) {
  bad('Applying local D1 migrations failed:')
  console.log(String(e.stderr || e.stdout || e.message))
  process.exit(1)
}

// ---------------------------------------------------------------- result

console.log('')
if (!githubReady && !demo) {
  for (const p of problems) bad(p)
  console.log(`
${bold('GitHub App credentials are needed to sign in.')} Create a GitHub App (about 5 minutes)
by following ${bold(DOC)}, paste its values into .dev.vars, and run ${bold('npm run setup')} again.

To try openscan without a GitHub App, sign in as a demo user that reads public repos:
  ${bold('npm run setup -- --demo')}
`)
  process.exit(1)
}
if (!githubReady) for (const p of problems) warn(`${p} (fine in demo mode; see ${DOC} for the real sign-in)`)
console.log(`${green('Ready.')} Start the app with ${bold('npm run dev')} and open http://localhost:3000`)

// ---------------------------------------------------------------- helpers

/** GET /app with an app JWT (RS256), the same check the Worker does on its first API call. */
async function whoAmI(appId, privateKeyPem) {
  const b64url = (b) => Buffer.from(b).toString('base64url')
  const iat = Math.floor(Date.now() / 1000) - 60
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iat, exp: iat + 300, iss: appId }))}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(createPrivateKey(privateKeyPem))
  const res = await fetch('https://api.github.com/app', {
    headers: {
      authorization: `Bearer ${unsigned}.${b64url(signature)}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'openscan-setup',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
  return res.json()
}
