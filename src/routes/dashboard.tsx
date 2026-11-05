import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Empty, SeverityBadge, StatusDot, TopBar, timeAgo } from '#/components/ui'
import { QuestionCard } from '#/components/QuestionCard'
import { getDashboard, startScan } from '#/server-fns/app'

export const Route = createFileRoute('/dashboard')({
  loader: () => getDashboard(),
  head: () => ({ meta: [{ title: 'Dashboard — openscan' }] }),
  component: Dashboard,
})

const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info']

function Dashboard() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const running = data.scans.some((s) => s.status === 'queued' || s.status === 'running')
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => router.invalidate(), 4000)
    return () => clearInterval(t)
  }, [running, router])
  const [repoId, setRepoId] = useState<number | undefined>(data.repos[0]?.id)
  const [busy, setBusy] = useState(false)
  const minIdx = SEV_ORDER.indexOf(data.preferences.minSeverity)
  const findings = data.findings.filter((f) => SEV_ORDER.indexOf(f.severity) <= minIdx)

  return (
    <div className="min-h-screen">
      <TopBar
        user={data.user}
        right={
          <Link to="/onboarding" search={{ step: 'repos' }} className="muted hover:underline">
            Settings
          </Link>
        }
      />
      <main className="mx-auto max-w-5xl space-y-12 px-4 py-10">
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Security overview</h1>
            <p className="muted text-sm">
              {data.repos.length} repositor{data.repos.length === 1 ? 'y' : 'ies'} · reports {data.preferences.frequency.replace('_', ' ')} ·{' '}
              {data.preferences.depth === 'deep_poc' ? 'deep research + PoC' : data.preferences.depth} ·{' '}
              {data.user.chatgpt ? `ChatGPT ${data.user.chatgpt.plan ?? ''}` : 'heuristic mode'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select className="input w-auto" value={repoId} onChange={(e) => setRepoId(Number(e.target.value))}>
              {data.repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fullName}
                </option>
              ))}
            </select>
            <button
              className="btn btn-primary whitespace-nowrap"
              disabled={!repoId || busy}
              onClick={async () => {
                if (!repoId) return
                setBusy(true)
                const { id } = await startScan({ data: { repoId, kind: 'security' } })
                await router.navigate({ to: '/scans/$scanId', params: { scanId: id } })
              }}
            >
              {busy ? 'Starting…' : 'Scan now'}
            </button>
          </div>
        </section>

        {data.questions.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
              Questions <span className="muted font-normal normal-case">— the AI couldn't answer these from code</span>
            </h2>
            <div className="grid gap-2 md:grid-cols-2">
              {data.questions.map((q) => (
                <QuestionCard key={q.id} q={q} />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
            Findings <span className="muted font-normal normal-case">— latest report per repository</span>
          </h2>
          <div className="app-card divide-y divide-[var(--line)]">
            {findings.length === 0 && <Empty>No open findings yet.</Empty>}
            {findings.map((f) => (
              <Link key={f.id} to="/scans/$scanId" params={{ scanId: f.scan_id }} hash={`f-${f.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-[color-mix(in_srgb,var(--fg)_3%,transparent)]">
                <SeverityBadge severity={f.severity} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{f.title}</span>
                  <span className="muted block truncate text-xs">
                    {f.repo}
                    {f.file ? ` · ${f.file}${f.line ? `:${f.line}` : ''}` : ''}
                  </span>
                </span>
                {f.poc && <span className="muted text-[11px]">PoC</span>}
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">Scans</h2>
          <div className="app-card divide-y divide-[var(--line)]">
            {data.scans.length === 0 && <Empty>No scans yet.</Empty>}
            {data.scans.map((s) => (
              <Link key={s.id} to="/scans/$scanId" params={{ scanId: s.id }} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-[color-mix(in_srgb,var(--fg)_3%,transparent)]">
                <StatusDot status={s.status} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{s.repo}</span>
                  <span className="muted ml-2">{s.kind === 'understand' ? 'repo reading' : 'security report'}</span>
                  {s.headline && <span className="muted block truncate text-xs">{s.headline}</span>}
                </span>
                {s.risk && s.kind === 'security' && <SeverityBadge severity={s.risk} />}
                <span className="muted w-24 text-right text-xs" suppressHydrationWarning>
                  {s.status === 'running' || s.status === 'queued' ? `${s.progress}%` : timeAgo(s.finished_at ?? s.created_at)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
