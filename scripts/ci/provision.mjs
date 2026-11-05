#!/usr/bin/env node
/**
 * CI only. Makes sure the Cloudflare resources the Worker binds to exist, then
 * points wrangler.jsonc at them (in the CI checkout only; never committed).
 *
 *   - D1 database "openscan": uses D1_DATABASE_ID if set, otherwise finds it by
 *     name, otherwise creates it. Its id replaces the placeholder `database_id`.
 *   - Queue "openscan-jobs": created if missing.
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const CONFIG = 'wrangler.jsonc'
const DB_NAME = 'openscan'
const QUEUE = 'openscan-jobs'

for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
  if (!process.env[k]) {
    console.error(`::error::${k} is missing. Add it to Bitwarden Secrets Manager.`)
    process.exit(1)
  }
}

function wrangler(args, { allowFail = false } = {}) {
  try {
    return execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    if (allowFail) return null
    process.stderr.write(err.stdout ?? '')
    process.stderr.write(err.stderr ?? '')
    throw err
  }
}

function findDatabase() {
  const out = wrangler(['d1', 'list', '--json'])
  // Wrangler may print warnings before the JSON; take from the first '['.
  const list = JSON.parse(out.slice(out.indexOf('[')))
  return list.find((d) => d.name === DB_NAME)?.uuid ?? null
}

// ---------------------------------------------------------------- D1
let dbId = process.env.D1_DATABASE_ID?.trim() || findDatabase()
if (!dbId) {
  console.log(`Creating D1 database "${DB_NAME}"…`)
  wrangler(['d1', 'create', DB_NAME])
  dbId = findDatabase()
  if (!dbId) throw new Error(`Created D1 database "${DB_NAME}" but could not find its id`)
}
console.log(`D1 database "${DB_NAME}": ${dbId}`)

const config = readFileSync(CONFIG, 'utf8')
const patched = config.replace(/("database_id"\s*:\s*")[^"]*(")/, `$1${dbId}$2`)
if (patched === config && !config.includes(dbId)) throw new Error(`Could not find "database_id" in ${CONFIG}`)
writeFileSync(CONFIG, patched)

// ---------------------------------------------------------------- Queue
if (wrangler(['queues', 'info', QUEUE], { allowFail: true }) === null) {
  console.log(`Creating queue "${QUEUE}"…`)
  wrangler(['queues', 'create', QUEUE])
}
console.log(`Queue "${QUEUE}": ready`)
