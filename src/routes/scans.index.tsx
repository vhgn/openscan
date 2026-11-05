import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { Empty, Lede, Page, Severity, StatusMark, Title, plural, timeAgo } from '#/components/ui'
import { Select } from '#/components/Select'
import { getScans } from '#/server-fns/app'
import type { ScanListItem } from '#/lib/queries'

const KINDS = [
  { id: 'security', label: 'Security briefs' },
  { id: 'understand', label: 'Repository reads' },
] as const
const STATUSES = [
  { id: 'live', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
] as const
type Kind = (typeof KINDS)[number]['id']
type Status = (typeof STATUSES)[number]['id']
const TRIGGER: Record<string, string> = { manual: 'on request', schedule: 'scheduled', push: 'on push', onboarding: 'first review' }

export interface ScansSearch {
  kind?: Kind
  status?: Status
  repo?: string
}

const isLive = (s: { status: string }) => s.status === 'queued' || s.status === 'running'
const matchesStatus = (s: ScanListItem, status: Status) => (status === 'live' ? isLive(s) : s.status === status)

/** Every scan, newest first: security briefs and repository reads, filterable by kind, status and repository. */
export const Route = createFileRoute('/scans/')({
  validateSearch: (s: Record<string, unknown>): ScansSearch => ({
    ...(KINDS.some((k) => k.id === s.kind) ? { kind: s.kind as Kind } : {}),
    ...(STATUSES.some((k) => k.id === s.status) ? { status: s.status as Status } : {}),
    ...(typeof s.repo === 'string' && s.repo ? { repo: s.repo } : {}),
  }),
  loader: () => getScans(),
  head: () => ({ meta: [{ title: 'Scans — openscan' }] }),
  component: ScansPage,
})

function ScansPage() {
  const { user, scans, limit } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/scans/' })
  const router = useRouter()
  const set = (patch: Partial<ScansSearch>) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const live = scans.filter(isLive).length
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => router.invalidate(), 4000)
    return () => clearInterval(t)
  }, [live, router])

  const byRepo = search.repo ? scans.filter((s) => s.repo === search.repo) : scans
  const byKind = search.kind ? byRepo.filter((s) => s.kind === search.kind) : byRepo
  const byStatus = search.status ? byRepo.filter((s) => matchesStatus(s, search.status!)) : byRepo
  const shown = search.status ? byKind.filter((s) => matchesStatus(s, search.status!)) : byKind
  const repos = [...new Set(scans.map((s) => s.repo))].sort((a, b) => a.localeCompare(b))

  return (
    <Page user={user}>
      <p className="label">Scans</p>
      <Title>Every scan, newest first.</Title>
      <Lede>
        Security briefs and repository reads across all your repositories{live ? `, ${plural(live, 'scan')} in progress` : ''}. Open one to see its progress, findings and
        activity log.
      </Lede>

      {scans.length > 0 && (
        <div className="mt-8 space-y-2.5">
          <ChipRow
            title="Kind"
            value={search.kind}
            onChange={(kind) => set({ kind })}
            options={KINDS.map((k) => ({ ...k, n: byStatus.filter((s) => s.kind === k.id).length }))}
          />
          <ChipRow
            title="Status"
            value={search.status}
            onChange={(status) => set({ status })}
            options={STATUSES.map((st) => ({ ...st, n: byKind.filter((s) => matchesStatus(s, st.id)).length }))}
          />
          {repos.length > 1 && (
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
              <span className="label w-14 shrink-0">Repo</span>
              <Select
                size="sans"
                className="max-w-[20rem]"
                label="Repository"
                value={search.repo ?? ''}
                onChange={(repo) => set({ repo: repo || undefined })}
                options={[{ value: '', label: 'All repositories' }, ...repos.map((r) => ({ value: r, label: r }))]}
              />
            </div>
          )}
        </div>
      )}

      <ol className="mt-8">
        {shown.length === 0 && <Empty>{scans.length ? 'No scans match these filters.' : 'No scans yet.'}</Empty>}
        {shown.map((s) => (
          <li key={s.id} className="border-t border-rule first:border-t-0">
            <Link to="/scans/$scanId" params={{ scanId: s.id }} className="group grid gap-1 py-3 sm:grid-cols-[6.5rem_1fr_auto] sm:items-baseline sm:gap-4">
              <span className="flex items-center gap-2 font-sans text-[12.5px] text-muted">
                <StatusMark status={s.status} />
                {isLive(s) ? `${s.progress}%` : timeAgo(s.finished_at ?? s.created_at)}
              </span>
              <span className="min-w-0">
                <span className="text-[17px] group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
                  {s.headline ?? (s.kind === 'understand' ? `Reading of ${s.repo}` : `Review of ${s.repo}`)}
                </span>
                <span className="block truncate font-sans text-[12.5px] text-muted">
                  {s.repo} · {s.kind === 'understand' ? 'repository read' : 'security brief'} · {TRIGGER[s.trigger] ?? s.trigger}
                  {isLive(s) && ` · ${s.status === 'queued' ? 'queued' : s.phase}`}
                  {(s.status === 'failed' || s.status === 'cancelled') && ` · ${s.status}`}
                  {s.status === 'completed' && s.kind === 'security' && ` · ${plural(s.findings, 'open finding')}`}
                </span>
              </span>
              {s.risk && s.kind === 'security' ? <Severity severity={s.risk} /> : <span />}
            </Link>
          </li>
        ))}
      </ol>
      {scans.length >= limit && <p className="mt-4 font-sans text-[12.5px] text-muted">Showing the {limit} most recent scans.</p>}
    </Page>
  )
}

/** One row of filter chips (same look as the findings filters); clicking the selected chip or "All" clears it. */
function ChipRow<T extends string>({
  title,
  value,
  onChange,
  options,
}: {
  title: string
  value: T | undefined
  onChange: (v: T | undefined) => void
  options: Array<{ id: T; label: string; n: number }>
}) {
  const chip = (on: boolean) =>
    `inline-flex items-baseline gap-1.5 px-2.5 py-1 font-sans text-[12.5px] transition-colors ${
      on ? 'bg-ink text-paper' : 'text-ink-3 shadow-[inset_0_0_0_1px_rgb(20_20_20/0.18)] hover:text-ink hover:shadow-[inset_0_0_0_1px_rgb(20_20_20/0.45)]'
    }`
  const count = (on: boolean) => `text-[10.5px] tabular-nums ${on ? 'text-paper/55' : 'text-faint'}`
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5" role="group" aria-label={`Filter by ${title.toLowerCase()}`}>
      <span className="label w-14 shrink-0">{title}</span>
      <button type="button" aria-pressed={!value} onClick={() => onChange(undefined)} className={chip(!value)}>
        All
      </button>
      {options
        .filter((o) => o.n > 0 || o.id === value)
        .map((o) => {
          const on = value === o.id
          return (
            <button key={o.id} type="button" aria-pressed={on} onClick={() => onChange(on ? undefined : o.id)} className={chip(on)}>
              {o.label}
              <span className={count(on)} aria-label={`${o.n} scans`}>
                {o.n}
              </span>
            </button>
          )
        })}
    </div>
  )
}
