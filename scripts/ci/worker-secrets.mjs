#!/usr/bin/env node
/**
 * CI only. Collects the Worker's runtime secrets from the environment (loaded
 * from Bitwarden) into a JSON file for `wrangler deploy --secrets-file`, and
 * writes the plain vars as `KEY:VALUE` lines (one `--var` each) to <out.json>.vars.
 *
 *   node scripts/ci/worker-secrets.mjs <out.json>
 *
 * Fails with a clear message if a required secret is missing.
 */
import { writeFileSync } from 'node:fs'

const REQUIRED_SECRETS = ['SESSION_SECRET', 'LWC_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_WEBHOOK_SECRET']
// Plain vars from wrangler.jsonc that production should override.
const REQUIRED_VARS = ['APP_URL']
const OPTIONAL_VARS = ['GITHUB_APP_SLUG', 'AI_MODE']

const out = process.argv[2]
if (!out) {
  console.error('usage: worker-secrets.mjs <out.json>')
  process.exit(2)
}

const missing = [...REQUIRED_SECRETS, ...REQUIRED_VARS].filter((k) => !process.env[k]?.trim())
if (missing.length) {
  for (const k of missing) console.error(`::error::${k} is missing. Add it to Bitwarden Secrets Manager.`)
  process.exit(1)
}

if (process.env.AI_MODE && process.env.AI_MODE !== 'auto' && process.env.AI_MODE !== 'heuristic') {
  console.error(`::error::AI_MODE must be "auto" or "heuristic" in production (got "${process.env.AI_MODE}").`)
  process.exit(1)
}

const secrets = Object.fromEntries(REQUIRED_SECRETS.map((k) => [k, process.env[k]]))
writeFileSync(out, JSON.stringify(secrets), { mode: 0o600 })

// One `--var KEY:VALUE` per line, consumed by the workflow. Values are not secret.
const vars = [...REQUIRED_VARS, ...OPTIONAL_VARS].filter((k) => process.env[k]?.trim())
// DEV_DEMO_LOGIN is always forced off in production.
const flags = [...vars.map((k) => `${k}:${process.env[k].trim()}`), 'DEV_DEMO_LOGIN:0']
writeFileSync(`${out}.vars`, flags.join('\n') + '\n')
console.error(`Prepared ${REQUIRED_SECRETS.length} Worker secrets and vars: ${[...vars, 'DEV_DEMO_LOGIN'].join(', ')}`)
