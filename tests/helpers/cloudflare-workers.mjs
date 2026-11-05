/**
 * Test stand-in for the 'cloudflare:workers' module (wired up by ./register.mjs).
 * One shared, mutable object: src/lib/env.ts reads it on every call, tests reset it.
 */
export const env = {}
