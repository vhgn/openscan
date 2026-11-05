import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold tracking-tight ${className}`}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 2 3 6v6c0 5 3.8 9.3 9 10 5.2-.7 9-5 9-10V6l-9-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="m8.5 12 2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      openscan
    </span>
  )
}

export function TopBar({ user, right }: { user?: { login: string; avatarUrl: string | null } | null; right?: ReactNode }) {
  return (
    <header className="border-b hairline">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link to="/" className="no-underline">
          <Logo />
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {right}
          {user && (
            <>
              <span className="muted hidden sm:inline">@{user.login}</span>
              {user.avatarUrl && <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full" />}
              <a href="/api/auth/logout" className="muted hover:underline">
                Sign out
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`sev-${severity} inline-block rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide`}>{severity}</span>
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--fg)_10%,transparent)]">
      <div className="h-full rounded-full bg-[var(--accent)] transition-all duration-700" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  )
}

export function StatusDot({ status }: { status: string }) {
  const color = status === 'completed' ? 'bg-emerald-500' : status === 'failed' ? 'bg-red-500' : 'bg-amber-500 pulse-dot'
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return ''
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted py-6 text-center text-sm">{children}</p>
}
