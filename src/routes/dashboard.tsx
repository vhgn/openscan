import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Empty, Lede, Margin, Page, SectionHead, Severity, StatusMark, Title, plural, spell, timeAgo } from '#/components/ui'
import { QuestionCard } from '#/components/QuestionCard'
import { getDashboard, scanProduct, startScan } from '#/server-fns/app'

export const Route = createFileRoute('/dashboard')({
  loader: () => getDashboard(),
  head: () => ({ meta: [{ title: 'Brief — openscan' }] }),
  component: Dashboard,
})

const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info']
const FREQ_PHRASE: Record<string, string> = {
  on_push: 'on every push',
  daily: 'every morning',
  weekly: 'every Monday',
  monthly: 'once a month',
  manual: 'only when you ask',
}
const DEPTH_PHRASE: Record<string, string> = {
  triage: 'a quick triage',
  standard: 'a standard review',
  deep_poc: 'deep research, with a proof of concept for every serious finding',
}

function headline(n: number, urgent: number, open: number) {
  if (n === 0 && open === 0) return 'Nothing needs your attention this week.'
  if (urgent > 0) return `${spell(urgent)[0].toUpperCase()}${spell(urgent).slice(1)} finding${urgent === 1 ? '' : 's'} should be fixed now.`
  if (n > 0) return `${spell(n)[0].toUpperCase()}${spell(n).slice(1)} finding${n === 1 ? '' : 's'} worth a look, nothing urgent.`
  return `${spell(open)[0].toUpperCase()}${spell(open).slice(1)} question${open === 1 ? '' : 's'} only you can answer.`
}

function Dashboard() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const running = data.scans.filter((s) => s.status === 'queued' || s.status === 'running')
  useEffect(() => {
    if (!running.length) return
    const t = setInterval(() => router.invalidate(), 4000)
    return () => clearInterval(t)
  }, [running.length, router])
  const [repoId, setRepoId] = useState<number | undefined>(data.repos[0]?.id)
  const [busy, setBusy] = useState<string | null>(null)
  const minIdx = SEV_ORDER.indexOf(data.preferences.minSeverity)
  const findings = data.findings.filter((f) => SEV_ORDER.indexOf(f.severity) <= minIdx)
  const hidden = data.findings.length - findings.length
  const urgent = findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length
  const codex = data.repos.filter((r) => r.codexEnv).length
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <Page user={data.user}>
      <p className="label">Security overview · {today}</p>
      <Title>{headline(findings.length, urgent, data.questions.length)}</Title>
      <Lede>
        openscan watches {plural(data.repos.length, 'repository', 'repositories')} and writes a brief {FREQ_PHRASE[data.preferences.frequency] ?? data.preferences.frequency}, backed by{' '}
        {DEPTH_PHRASE[data.preferences.depth] ?? data.preferences.depth}.{' '}
        {data.user.chatgpt ? (
          <>
            Inference runs on your ChatGPT{data.user.chatgpt.plan ? ` ${data.user.chatgpt.plan}` : ''} plan
            {codex > 0 ? `, and agents work in Codex Cloud for ${codex} of them` : ''}.
          </>
        ) : (
          <>
            ChatGPT isn&rsquo;t connected, so the built-in analyzer does the reading.{' '}
            <Link to="/settings" className="link">
              Connect it
            </Link>{' '}
            for a real review.
          </>
        )}
      </Lede>

      {running.length > 0 && (
        <p className="mt-6 flex items-center gap-2 font-sans text-[13px] text-muted">
          <StatusMark status="running" /> {running.length === 1 ? 'A review is' : `${running.length} reviews are`} in progress:{' '}
          {running.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ', '}
              <Link to="/scans/$scanId" params={{ scanId: s.id }} className="link text-ink-3">
                {s.repo} ({s.progress}%)
              </Link>
            </span>
          ))}
        </p>
      )}

      <form
        className="mt-8 flex flex-wrap items-end gap-3 font-sans text-[14px]"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!repoId) return
          setBusy('scan')
          try {
            const { id } = await startScan({ data: { repoId, kind: 'security' } })
            await router.navigate({ to: '/scans/$scanId', params: { scanId: id } })
          } finally {
            setBusy(null)
          }
        }}
      >
        <span className="pb-1.5 text-muted">Run a fresh review of</span>
        <select className="field w-auto max-w-[18rem] font-sans text-[14px]" value={repoId} onChange={(e) => setRepoId(Number(e.target.value))} aria-label="Repository">
          {data.repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.fullName}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" disabled={!repoId || busy !== null}>
          {busy === 'scan' ? 'Starting…' : 'Start'}
        </button>
      </form>

      {data.questions.length > 0 && (
        <>
          <SectionHead aside="It couldn’t settle these from the code">Questions for you</SectionHead>
          <div className="mt-5 space-y-7">
            {data.questions.map((q) => (
              <QuestionCard key={q.id} q={q} />
            ))}
          </div>
        </>
      )}

      <SectionHead aside={hidden > 0 ? `${hidden} below ${data.preferences.minSeverity} hidden` : 'Latest brief per repository'}>Open findings</SectionHead>
      <ol className="mt-4">
        {findings.length === 0 && <Empty>No open findings.</Empty>}
        {findings.map((f) => (
          <li key={f.id} className="border-t border-rule first:border-t-0">
            <Link to="/scans/$scanId" params={{ scanId: f.scan_id }} hash={`f-${f.id}`} className="group grid gap-1 py-4 sm:grid-cols-[6.5rem_1fr] sm:gap-4">
              <span className="pt-1.5">
                <Severity severity={f.severity} />
              </span>
              <span className="min-w-0">
                <span className="block text-[19px] leading-[1.4] group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">{f.title}</span>
                <span className="mt-0.5 block truncate font-sans text-[12.5px] text-muted">
                  {f.repo}
                  {f.file && (
                    <>
                      {' '}
                      · <span className="font-mono">{f.file}{f.line ? `:${f.line}` : ''}</span>
                    </>
                  )}
                  {f.verdict === 'confirmed' && ' · verified'}
                  {f.poc && ' · proof of concept'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <SectionHead
        aside={
          <Link to="/products/$productId" params={{ productId: 'new' }} className="link">
            New product
          </Link>
        }
      >
        Products
      </SectionHead>
      <div className="mt-4 space-y-6">
        {data.products.length === 0 && <Empty>No products yet.</Empty>}
        {data.products.map((p) => (
          <div key={p.id} className="relative border-t border-rule pt-4 first:border-t-0 first:pt-0">
            <Link to="/products/$productId" params={{ productId: p.id }} className="font-display text-[28px] leading-tight hover:underline hover:decoration-1 hover:underline-offset-4">
              {p.name}
            </Link>
            <p className="mt-1 text-[17px] leading-[1.55] text-ink-3">
              {plural(p.repos, 'repository', 'repositories')}. Its memory holds {plural(p.memory.facts, 'fact')}, {plural(p.memory.reviewed, 'reviewed file')} and{' '}
              {plural(p.memory.verdicts, 'verdict')}.
            </p>
            <button
              className="btn btn-quiet btn-sm mt-3"
              disabled={busy !== null || p.repos === 0}
              onClick={async () => {
                setBusy(p.id)
                try {
                  await scanProduct({ data: { productId: p.id } })
                  await router.invalidate()
                } finally {
                  setBusy(null)
                }
              }}
            >
              {busy === p.id ? 'Queuing…' : `Review all ${p.repos}`}
            </button>
            {p.memory.saved > 0 && <Margin>Memory has saved {plural(p.memory.saved, 're-check')} so far.</Margin>}
          </div>
        ))}
      </div>

      <SectionHead>Earlier briefs</SectionHead>
      <ol className="mt-4">
        {data.scans.length === 0 && <Empty>No scans yet.</Empty>}
        {data.scans.map((s) => (
          <li key={s.id} className="border-t border-rule first:border-t-0">
            <Link to="/scans/$scanId" params={{ scanId: s.id }} className="group grid gap-1 py-3 sm:grid-cols-[6.5rem_1fr_auto] sm:items-baseline sm:gap-4">
              <span className="flex items-center gap-2 font-sans text-[12.5px] text-muted">
                <StatusMark status={s.status} />
                {s.status === 'running' || s.status === 'queued' ? `${s.progress}%` : timeAgo(s.finished_at ?? s.created_at)}
              </span>
              <span className="min-w-0">
                <span className="text-[17px] group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">{s.headline ?? (s.kind === 'understand' ? `Reading of ${s.repo}` : `Review of ${s.repo}`)}</span>
                <span className="block truncate font-sans text-[12.5px] text-muted">
                  {s.repo} · {s.kind === 'understand' ? 'repository reading' : 'security brief'} · {s.trigger}
                  {s.status === 'failed' && ' · failed'}
                </span>
              </span>
              {s.risk && s.kind === 'security' ? <Severity severity={s.risk} /> : <span />}
            </Link>
          </li>
        ))}
      </ol>
    </Page>
  )
}
