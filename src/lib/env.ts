import { env as cfEnv } from 'cloudflare:workers'

/** Typed access to Worker bindings, vars and secrets. */
export function env(): Env {
  return cfEnv as Env
}

export function str(name: string): string {
  const v = (env() as unknown as Record<string, unknown>)[name]
  return typeof v === 'string' ? v : ''
}

export function appUrl(): string {
  return (str('APP_URL') || 'http://localhost:3000').replace(/\/+$/, '')
}

export function isDemoLoginEnabled(): boolean {
  return str('DEV_DEMO_LOGIN') === '1'
}

export function aiMode(): 'auto' | 'heuristic' {
  return str('AI_MODE') === 'heuristic' ? 'heuristic' : 'auto'
}
