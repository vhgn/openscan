/**
 * Loaded with `node --import ./tests/helpers/register.mjs` (see the "test" npm script).
 *
 * src/lib/env.ts imports `env` from 'cloudflare:workers', a module that only exists
 * inside workerd. This in-thread resolve hook points that specifier at a plain object
 * (./cloudflare-workers.mjs) that tests fill with bindings: see resetEnv() in ./harness.ts.
 * Everything else resolves normally (tsx handles .ts files and the #/* alias).
 */
import { registerHooks } from 'node:module'

const stub = new URL('./cloudflare-workers.mjs', import.meta.url).href

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: stub, shortCircuit: true }
    return next(specifier, context)
  },
})
