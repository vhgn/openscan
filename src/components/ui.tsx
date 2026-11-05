/**
 * Essay design system: shared building blocks for every signed-in page.
 * Paper, ink, a serif reading column with notes in the margin, small sans labels,
 * and a cream squiggle for emphasis. Tokens live in src/styles.css.
 */
import { Link } from '@tanstack/react-router'
import { useId, type ReactNode } from 'react'

export interface MastheadUser {
  login: string
  name?: string | null
  avatarUrl: string | null
}

/** Text with a squiggle that draws in when `on` becomes true and wipes out when it turns false. */
export function Squiggle({ on, children, className = '' }: { on: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={`squiggle-draw ${className}`} data-on={on}>
      {children}
    </span>
  )
}

export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`font-display text-[24px] leading-none ${className}`}>openscan</span>
}

const NAV = [
  { to: '/home', label: 'Brief' },
  { to: '/scans', label: 'Scans' },
  { to: '/skills', label: 'Methods' },
  { to: '/settings', label: 'Settings' },
] as const

/** Signed-in masthead: wordmark, optional crumb, navigation, account. */
export function Masthead({ user, crumb, nav = true }: { user?: MastheadUser | null; crumb?: ReactNode; nav?: boolean }) {
  return (
    <header className="border-b border-rule">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 font-sans text-[13px]">
        <Link to={user ? '/home' : '/'} className="text-ink">
          <Wordmark />
        </Link>
        {crumb && (
          <>
            <span className="text-faint">/</span>
            <span className="min-w-0 truncate font-medium">{crumb}</span>
          </>
        )}
        <span className="ml-auto flex items-center gap-5 text-ink-3">
          {nav &&
            user &&
            NAV.map((n) => (
              <Link key={n.to} to={n.to} className="hover:text-ink" activeProps={{ className: 'text-ink' }}>
                {({ isActive }) => <Squiggle on={isActive}>{n.label}</Squiggle>}
              </Link>
            ))}
          {user && (
            <span className="flex items-center gap-3">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" title={`@${user.login}`} className="h-7 w-7 rounded-full grayscale" />
              ) : (
                <span title={`@${user.login}`} className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[11px] font-semibold uppercase text-paper">
                  {user.login.slice(0, 2)}
                </span>
              )}
              <a href="/api/auth/logout" className="text-muted hover:text-ink">
                Sign out
              </a>
            </span>
          )}
        </span>
      </nav>
    </header>
  )
}

/** Page frame: masthead plus a centred article. Content sits in a 42rem reading column. */
export function Page({ user, crumb, nav, children, wide = false }: { user?: MastheadUser | null; crumb?: ReactNode; nav?: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-paper font-serif text-ink">
      <Masthead user={user} crumb={crumb} nav={nav} />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-12">
        <div className={wide ? '' : 'max-w-[42rem]'}>{children}</div>
      </main>
    </div>
  )
}

/** Note set in the right margin on wide screens, inline below on narrow ones. */
export function Margin({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <aside className={`mt-2 font-sans text-[12.5px] leading-snug text-muted lg:absolute lg:left-[calc(100%+2.5rem)] lg:top-1 lg:mt-0 lg:w-52 ${className}`}>{children}</aside>
  )
}

/**
 * A term with an explanation on hover or keyboard focus. The dotted underline
 * says "there is more here"; the note itself is a small ink card below the term.
 */
export function Hint({ text, children }: { text: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <span className="group/hint relative inline-block">
      <span
        tabIndex={0}
        aria-describedby={id}
        className="cursor-help underline decoration-faint decoration-dotted decoration-1 underline-offset-[5px] outline-none group-hover/hint:decoration-ink focus-visible:decoration-ink"
      >
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-30 mt-2.5 w-72 max-w-[calc(100vw-2rem)] bg-ink px-3.5 py-2.5 font-sans text-[12.5px] font-normal normal-case leading-snug tracking-normal text-paper opacity-0 shadow-[0_6px_24px_rgb(20_20_20/0.18)] transition-opacity duration-150 group-hover/hint:visible group-hover/hint:opacity-100 group-focus-within/hint:visible group-focus-within/hint:opacity-100"
      >
        {text}
      </span>
    </span>
  )
}

/** Small-caps section label; `hint` explains the term in a tooltip. */
export function SectionHead({ children, aside, hint, className = 'mt-20' }: { children: ReactNode; aside?: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ${className}`}>
      <h2 className="label">{hint ? <Hint text={hint}>{children}</Hint> : children}</h2>
      {aside && <span className="font-sans text-[13px] text-muted">{aside}</span>}
    </div>
  )
}

export function Lede({ children }: { children: ReactNode }) {
  return <p className="mt-6 text-[19px] leading-[1.65] text-ink-2">{children}</p>
}

export function Title({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h1 className={`mt-4 font-display text-[44px] leading-[1.05] sm:text-[56px] ${className}`} style={{ textWrap: 'balance' }}>
      {children}
    </h1>
  )
}

const SEV_COLOR: Record<string, string> = {
  critical: 'text-alarm',
  high: 'text-[#b4472b]',
  medium: 'text-amber',
  low: 'text-[#4a5a7a]',
  info: 'text-muted',
  none: 'text-muted',
}

/** Severity as a word in small caps, not a coloured pill. */
export function Severity({ severity, className = '' }: { severity: string; className?: string }) {
  return <span className={`font-sans text-[11px] font-semibold uppercase tracking-[0.16em] ${SEV_COLOR[severity] ?? 'text-muted'} ${className}`}>{severity}</span>
}

/** Validator verdict, phrased the way the brief talks. */
export function Verdict({ verdict }: { verdict: string | null }) {
  if (verdict === 'confirmed') return <span className="squiggle italic">verified</span>
  if (verdict === 'needs_validation') return <span className="italic text-amber">needs your answer</span>
  if (verdict === 'rejected') return <span className="italic text-muted">rejected</span>
  return <span className="italic text-muted">not independently validated</span>
}

export function StatusMark({ status }: { status: string }) {
  if (status === 'completed') return <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink" aria-label="completed" />
  if (status === 'failed') return <span className="inline-block h-1.5 w-1.5 rounded-full bg-alarm" aria-label="failed" />
  if (status === 'cancelled') return <span className="inline-block h-1.5 w-1.5 rounded-full border border-muted" aria-label="cancelled" />
  return <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-gold" aria-label={status} />
}

/** Hairline progress rule. */
export function Progress({ value }: { value: number }) {
  return (
    <div className="h-[2px] w-full bg-rule">
      <div className="h-full bg-ink transition-all duration-700" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-[17px] italic text-muted">{children}</p>
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="mt-3 font-sans text-[13px] text-alarm">{children}</p>
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return ''
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

/** Spelled-out small numbers read better in prose. */
export function spell(n: number, zero = 'no'): string {
  const words = [zero, 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
  return n >= 0 && n < words.length ? words[n] : String(n)
}

export function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <Wordmark className="pulse-dot text-muted" />
    </div>
  )
}

const PHASES: Record<string, string> = {
  init: 'getting started',
  read: 'reading the code',
  profile: 'writing the profile',
  deps: 'checking dependencies',
  review: 'looking for vulnerabilities',
  validate: 'trying to disprove each finding',
  triage: 'writing the brief',
  done: 'done',
  codex_recon: 'starting a Codex recon task',
  codex_recon_wait: 'Codex is mapping the repository',
  codex_hunt: 'starting a Codex hunt task',
  codex_hunt_wait: 'Codex is hunting for vulnerabilities',
  codex_validate: 'starting a Codex validation task',
  codex_validate_wait: 'Codex is trying to disprove each finding',
}

/** Scan phase in words. */
export function phaseLabel(phase: string): string {
  return PHASES[phase] ?? phase.replace(/_/g, ' ')
}
