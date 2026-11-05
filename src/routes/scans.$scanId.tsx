import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { Progress, SeverityBadge, StatusDot, TopBar } from '#/components/ui'
import { QuestionCard } from '#/components/QuestionCard'
import { getScan, updateFindingStatus } from '#/server-fns/app'
import type { RepoProfile, ScanSummary } from '#/lib/types'
import { SKILL_BY_ID } from '#/lib/skills/registry'

const SOURCE_LABEL: Record<string, string> = {
  'ai-review': 'AI review',
  heuristic: 'pattern rule',
  osv: 'OSV.dev advisory',
  'runtime-advisory': 'runtime advisory',
  'code-scanning': 'GitHub code scanning',
  'supply-chain': 'supply-chain check',
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return null
  const style =
    verdict === 'confirmed'
      ? 'bg-emerald-600 text-white'
      : verdict === 'needs_validation'
        ? 'border border-amber-500 text-amber-600'
        : 'bg-stone-400 text-white'
  const label = verdict === 'confirmed' ? '✓ verified' : verdict === 'needs_validation' ? 'needs validation' : 'rejected'
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style}`}>{label}</span>
}

function parseList(json: string | null): string[] {
  try {
    const v = json ? JSON.parse(json) : []
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

export const Route = createFileRoute('/scans/$scanId')({
  loader: ({ params }) => getScan({ data: { id: params.scanId } }),
  head: () => ({ meta: [{ title: 'Scan — openscan' }] }),
  component: ScanPage,
})

function ScanPage() {
  const d = Route.useLoaderData()
  const router = useRouter()
  const live = d.scan.status === 'queued' || d.scan.status === 'running'
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => router.invalidate(), 2000)
    return () => clearInterval(t)
  }, [live, router])

  const summary = d.scan.kind === 'security' && d.scan.summary?.headline ? (d.scan.summary as ScanSummary) : null
  const profile: RepoProfile | null = (d.scan.kind === 'understand' ? (d.scan.summary?.profile ?? d.profile) : d.profile) ?? null
  const open = d.findings.filter((f) => f.status === 'open')
  const closed = d.findings.filter((f) => f.status !== 'open')

  return (
    <div className="min-h-screen">
      <TopBar
        right={
          <Link to="/dashboard" className="muted hover:underline">
            ← Dashboard
          </Link>
        }
      />
      <main className="mx-auto max-w-5xl space-y-10 px-4 py-10">
        <header>
          <p className="muted text-sm">
            {d.scan.kind === 'understand' ? 'Repository reading' : 'Security report'} · {d.scan.trigger} ·{' '}
            {d.scan.engine === 'codex' ? 'Codex Cloud' : d.scan.engine === 'ai' ? `AI (${d.scan.model})` : d.scan.engine ?? '…'}
            {d.scan.commit_sha && <> · <span className="font-mono">{d.scan.commit_sha.slice(0, 7)}</span></>}
          </p>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-bold tracking-tight">
            <StatusDot status={d.scan.status} /> {d.scan.repo}
          </h1>
          {live && (
            <div className="mt-4 max-w-md">
              <Progress value={d.scan.progress} />
              <p className="muted mt-1 text-xs">
                {d.scan.phase} · {d.scan.progress}%
              </p>
            </div>
          )}
          {d.scan.status === 'failed' && <p className="mt-3 text-sm text-red-600">Failed: {d.scan.error}</p>}
          {d.codexTasks.length > 0 && (
            <p className="mt-3 flex flex-wrap gap-2 text-xs">
              {d.codexTasks.map((t) => (
                <a key={t.id} href={t.url} target="_blank" rel="noreferrer" className="rounded-full border hairline px-2.5 py-1 hover:border-[var(--muted)]">
                  Codex {t.role} task · {t.status} ↗
                </a>
              ))}
            </p>
          )}
        </header>

        {summary && (
          <section className="app-card p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide">Overall risk</span>
              <SeverityBadge severity={summary.riskLevel} />
              <span className="muted text-xs">
                {summary.filesReviewed} files reviewed · {summary.dependenciesChecked} dependencies checked
                {summary.validation && summary.validation.confirmed + summary.validation.rejected + summary.validation.needs_validation > 0 && (
                  <>
                    {' '}· validator: {summary.validation.confirmed} verified, {summary.validation.needs_validation} need validation, {summary.validation.rejected} rejected
                  </>
                )}
              </span>
            </div>
            <p className="mt-3 text-lg font-semibold">{summary.headline}</p>
            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide">What matters</p>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {summary.whatMatters.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide">What to do next</p>
                <ol className="list-decimal space-y-2 pl-5 text-sm">
                  {summary.nextActions.map((a) => (
                    <li key={a.action}>
                      <span className="font-medium">{a.action}</span> <span className="muted text-xs">({a.effort})</span>
                      <span className="muted block text-xs">{a.why}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            {summary.memory && summary.memory.skippedFiles + summary.memory.reusedVerdicts > 0 && (
              <p className="muted mt-4 text-xs">
                Product memory: skipped {summary.memory.skippedFiles} file(s) already reviewed at this version and reused {summary.memory.reusedVerdicts} earlier verdict(s).
              </p>
            )}
            {summary.needsValidation && summary.needsValidation.length > 0 && (
              <div className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide">Needs your input (no severity until answered)</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {summary.needsValidation.map((n) => (
                    <li key={n.title}>
                      <span className="font-medium">{n.title}</span>
                      {n.missingFact && <span className="muted block text-xs">{n.missingFact}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.engineNote && <p className="muted mt-4 text-xs">{summary.engineNote}</p>}
          </section>
        )}

        {profile && d.scan.kind === 'understand' && (
          <section className="app-card p-6 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide">What the AI learned</p>
            <p>{profile.summary}</p>
            <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {(
                [
                  ['Stack', profile.stack.join(', ')],
                  ['Entry points', profile.entryPoints.join(', ')],
                  ['Data stores', profile.dataStores.join(', ')],
                  ['Auth', profile.auth],
                  ['External services', profile.externalServices.join(', ')],
                  ['Deployment', profile.deployment],
                  ['Sensitive areas', profile.sensitiveAreas.join(', ')],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="muted text-xs">{k}</dt>
                  <dd>{v || 'Unknown'}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {d.questions.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">Questions raised during this scan</h2>
            <div className="grid gap-2 md:grid-cols-2">
              {d.questions.map((q) => (
                <QuestionCard key={q.id} q={q} />
              ))}
            </div>
          </section>
        )}

        {d.scan.kind === 'security' && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">Findings ({open.length})</h2>
            <div className="space-y-3">
              {open.map((f) => (
                <details key={f.id} id={`f-${f.id}`} className="app-card group p-4" open={open.length <= 3}>
                  <summary className="flex cursor-pointer list-none items-start gap-3">
                    <span className="flex flex-col items-start gap-1">
                      <SeverityBadge severity={f.severity} />
                      <VerdictBadge verdict={f.verdict} />
                    </span>
                    <span className="flex-1">
                      <span className="font-medium">
                        {f.priority ? <span className="muted mr-1">#{f.priority}</span> : null}
                        {f.title}
                      </span>
                      <span className="muted block text-xs">
                        {f.category}
                        {f.file ? ` · ${f.file}${f.line ? `:${f.line}` : ''}` : ''} · confidence {f.confidence}
                        {f.source ? ` · ${SOURCE_LABEL[f.source] ?? f.source}` : ''}
                      </span>
                    </span>
                  </summary>
                  <div className="mt-3 space-y-2 pl-1 text-sm">
                    {f.threat_model && <p className="font-medium">{f.threat_model}</p>}
                    <p className="whitespace-pre-line">{f.description}</p>
                    {parseList(f.trace_json).length > 0 && (
                      <div>
                        <p className="font-semibold">Source → sink</p>
                        <ol className="mt-1 list-decimal space-y-0.5 pl-5 font-mono text-xs">
                          {parseList(f.trace_json).map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {f.impact && (
                      <p>
                        <span className="font-semibold">Impact: </span>
                        {f.impact}
                      </p>
                    )}
                    {f.recommendation && (
                      <p>
                        <span className="font-semibold">Fix: </span>
                        {f.recommendation}
                      </p>
                    )}
                    {f.verification && (
                      <div className="rounded-lg border hairline p-3">
                        <p className="font-semibold">Independent validation</p>
                        <p className="muted mt-1 whitespace-pre-line text-xs">{f.verification}</p>
                      </div>
                    )}
                    {f.poc && (
                      <div>
                        <p className="font-semibold">Research / proof of concept</p>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-[color-mix(in_srgb,var(--fg)_6%,transparent)] p-3 font-mono text-xs">{f.poc}</pre>
                      </div>
                    )}
                    <div className="flex gap-3 pt-1 text-xs">
                      {(['fixed', 'dismissed'] as const).map((s) => (
                        <button
                          key={s}
                          className="muted underline"
                          onClick={async () => {
                            await updateFindingStatus({ data: { id: f.id, status: s } })
                            await router.invalidate()
                          }}
                        >
                          Mark {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </details>
              ))}
              {open.length === 0 && !live && <p className="muted text-sm">No open findings.</p>}
              {closed.length > 0 && (
                <details className="text-xs">
                  <summary className="muted cursor-pointer">{closed.length} finding(s) rejected by the validator, dismissed as false positives, or marked fixed</summary>
                  <ul className="mt-2 space-y-2">
                    {closed.map((f) => (
                      <li key={f.id} className="rounded-lg border hairline p-2">
                        <span className="font-medium">{f.title}</span> <span className="muted">({f.status}{f.verdict ? `, ${f.verdict}` : ''})</span>
                        {f.verification && <p className="muted mt-1 whitespace-pre-line">{f.verification}</p>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </section>
        )}

        {d.skills.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
              Methodology <span className="muted font-normal normal-case">— agentic security skills applied in this scan</span>
            </h2>
            <ul className="flex flex-wrap gap-2 text-xs">
              {d.skills.map((id) => {
                const sk = SKILL_BY_ID[id]
                return sk ? (
                  <li key={id}>
                    <a href={sk.repoUrl} target="_blank" rel="noreferrer" className="inline-block rounded-full border hairline px-2.5 py-1 hover:border-[var(--muted)]" title={sk.howUsed}>
                      {sk.name} <span className="muted">· {sk.publisher}</span>
                    </a>
                  </li>
                ) : null
              })}
            </ul>
            <p className="muted mt-2 text-xs">
              <Link to="/skills" className="underline">
                How each skill is used
              </Link>
            </p>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">Activity</h2>
          <ol className="app-card max-h-80 space-y-1 overflow-y-auto p-4 font-mono text-xs">
            {d.events.map((e) => (
              <li key={e.id} className={e.level === 'error' ? 'text-red-500' : e.level === 'warn' ? 'text-amber-600' : ''}>
                <span className="muted" suppressHydrationWarning>{new Date(e.ts).toLocaleTimeString()}</span> {e.message}
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  )
}
