import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { Empty, ErrorNote, Lede, Margin, Page, Progress, SectionHead, Severity, StatusMark, Title, Verdict, phaseLabel, spell, timeAgo } from '#/components/ui'
import { QuestionCard, QuestionList } from '#/components/QuestionCard'
import { FindingFilters, applyFindingFilters, isArea, isLevel, type FindingFilterState } from '#/components/FindingFilters'
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

const EFFORT: Record<string, string> = { small: 'under an hour', medium: 'about half a day', large: 'a few days' }

function parseList(json: string | null): string[] {
  try {
    const v = json ? JSON.parse(json) : []
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

function engineLabel(engine: string | null, model: string | null) {
  if (engine === 'codex') return 'Codex Cloud'
  if (engine === 'ai') return model ? `ChatGPT (${model})` : 'ChatGPT'
  if (engine === 'heuristic') return 'the built-in analyzer'
  return engine ?? '…'
}

export const Route = createFileRoute('/scans/$scanId')({
  // Finding filters live in the URL so a filtered brief can be shared.
  validateSearch: (q: Record<string, unknown>): FindingFilterState => ({
    ...(isLevel(q.level) ? { level: q.level } : {}),
    ...(isArea(q.area) ? { area: q.area } : {}),
  }),
  loader: ({ params }) => getScan({ data: { id: params.scanId } }),
  head: () => ({ meta: [{ title: 'Security brief — openscan' }] }),
  component: ScanPage,
})

function ScanPage() {
  const d = Route.useLoaderData()
  const filters = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const s = d.scan
  const live = s.status === 'queued' || s.status === 'running'
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => router.invalidate(), 2000)
    return () => clearInterval(t)
  }, [live, router])

  const summary = s.kind === 'security' && s.summary?.headline ? (s.summary as ScanSummary) : null
  const profile: RepoProfile | null = (s.kind === 'understand' ? (s.summary?.profile ?? d.profile) : d.profile) ?? null
  const openAll = d.findings.filter((f) => f.status === 'open')
  const open = applyFindingFilters(openAll, filters)
  const filtered = Boolean(filters.level || filters.area)
  const closed = d.findings.filter((f) => f.status !== 'open')
  const date = new Date(s.finished_at ?? s.created_at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const v = summary?.validation
  const candidates = v ? v.confirmed + v.rejected + v.needs_validation + v.unverified : 0

  return (
    <Page user={d.user} crumb={s.repo}>
      <p className="label">
        {s.kind === 'understand' ? 'Repository reading' : 'Security brief'} · {s.repo} · {s.trigger}
        {s.product_id && s.product && (
          <>
            {' · '}
            <Link to="/products/$productId" params={{ productId: s.product_id }} className="link">
              {s.product}
            </Link>
          </>
        )}
      </p>
      <p className="mt-2 font-sans text-[13px] text-muted">
        {date}
        {s.commit_sha && (
          <>
            {' '}
            · {/^[0-9a-f]{7,40}$/i.test(s.commit_sha) ? 'commit' : 'on'} <span className="font-mono">{/^[0-9a-f]{7,40}$/i.test(s.commit_sha) ? s.commit_sha.slice(0, 7) : s.commit_sha}</span>
          </>
        )}{' '}
        · reviewed by {engineLabel(s.engine, s.model)}
      </p>

      {/* headline */}
      {summary ? (
        <Title className="mt-6">{summary.headline}</Title>
      ) : s.kind === 'understand' ? (
        <Title className="mt-6">{live ? `Reading ${s.repo}.` : s.status === 'failed' ? `Reading ${s.repo} failed.` : `What we learned about ${s.repo}.`}</Title>
      ) : (
        <Title className="mt-6">{s.status === 'failed' ? 'This review did not finish.' : 'The review is under way.'}</Title>
      )}

      {live && (
        <div className="mt-8 max-w-md">
          <div className="mb-2 flex items-center gap-2 font-sans text-[13px] text-muted">
            <StatusMark status={s.status} /> {phaseLabel(s.phase)} · {s.progress}%
          </div>
          <Progress value={s.progress} />
          <p className="mt-3 text-[16px] italic text-muted">This page updates by itself. You can leave; the brief will be on your home page.</p>
        </div>
      )}
      {s.status === 'failed' && <ErrorNote>Failed: {s.error}</ErrorNote>}

      {d.codexTasks.length > 0 && (
        <p className="mt-6 font-sans text-[13px] text-muted">
          Codex Cloud tasks:{' '}
          {d.codexTasks.map((t, i) => (
            <span key={t.id}>
              {i > 0 && ' · '}
              <a href={t.url} target="_blank" rel="noreferrer" className="link text-ink-3">
                {t.role} ({t.status}) ↗
              </a>
            </span>
          ))}
        </p>
      )}

      {summary && (
        <>
          <Lede>
            Overall risk is <span className="squiggle italic">{summary.riskLevel}</span>.{' '}
            {v && candidates > 0 ? (
              <>
                Of {spell(candidates)} candidate issue{candidates === 1 ? '' : 's'}, an independent validator confirmed {spell(v.confirmed)}, rejected {spell(v.rejected, 'none')}, and left{' '}
                {spell(v.needs_validation, 'none')} for you to decide.{' '}
              </>
            ) : null}
            We read {summary.filesReviewed} file{summary.filesReviewed === 1 ? '' : 's'} and checked {summary.dependenciesChecked} dependenc{summary.dependenciesChecked === 1 ? 'y' : 'ies'}
            {summary.memory && summary.memory.skippedFiles + summary.memory.reusedVerdicts > 0 ? (
              <>
                ; product memory let us skip {summary.memory.skippedFiles} unchanged file{summary.memory.skippedFiles === 1 ? '' : 's'} and reuse {summary.memory.reusedVerdicts} earlier verdict
                {summary.memory.reusedVerdicts === 1 ? '' : 's'}
              </>
            ) : null}
            .
          </Lede>
          {summary.engineNote && <p className="mt-3 font-sans text-[13px] text-muted">{summary.engineNote}</p>}

          {summary.whatMatters.length > 0 && (
            <>
              <SectionHead className="mt-16">What matters</SectionHead>
              <ul className="mt-4 space-y-4 text-[19px] leading-[1.5]">
                {summary.whatMatters.map((m) => (
                  <li key={m} className="grid grid-cols-[1.25rem_1fr]">
                    <span className="text-gold">—</span>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {summary.nextActions.length > 0 && (
            <>
              <SectionHead className="mt-16">What to do next</SectionHead>
              <ol className="mt-4 space-y-6 text-[19px] leading-[1.5]">
                {summary.nextActions.map((a, i) => (
                  <li key={a.action} className="relative grid grid-cols-[1.75rem_1fr]">
                    <span className="font-display text-[24px] leading-none">{i + 1}.</span>
                    <span>
                      {a.action} <span className="text-ink-3">{a.why}</span>
                    </span>
                    <Margin>Effort: {EFFORT[a.effort] ?? a.effort}</Margin>
                  </li>
                ))}
              </ol>
            </>
          )}

          {summary.needsValidation && summary.needsValidation.length > 0 && (
            <>
              <SectionHead className="mt-16">Waiting on one fact from you</SectionHead>
              <p className="mt-3 text-[17px] leading-[1.6] text-ink-3">These have no severity yet. Each depends on something only your team knows; answer below and the next scan settles it.</p>
              <ul className="mt-4 space-y-4 text-[18px] leading-[1.45]">
                {summary.needsValidation.map((n) => (
                  <li key={n.title}>
                    <span className="font-medium">{n.title}.</span> {n.missingFact && <span className="italic text-amber">{n.missingFact}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* understand scans: the profile, written out */}
      {profile && s.kind === 'understand' && (
        <>
          <Lede>{profile.summary}</Lede>
          <dl className="mt-10 space-y-4 text-[17px] leading-[1.55]">
            {(
              [
                ['Stack', profile.stack.join(', ')],
                ['Entry points', profile.entryPoints.join(', ')],
                ['Data stores', profile.dataStores.join(', ')],
                ['Authentication', profile.auth],
                ['External services', profile.externalServices.join(', ')],
                ['Deployment', profile.deployment],
                ['Sensitive areas', profile.sensitiveAreas.join(', ')],
              ] as const
            ).map(([k, val]) => (
              <div key={k} className="grid gap-1 border-t border-rule pt-3 sm:grid-cols-[10rem_1fr] sm:gap-6">
                <dt className="label pt-1.5">{k}</dt>
                <dd className={val ? '' : 'italic text-muted'}>{val || 'Not found in the code'}</dd>
              </div>
            ))}
          </dl>
          {profile.notes.length > 0 && (
            <ul className="mt-6 space-y-2 font-sans text-[13px] leading-snug text-muted">
              {profile.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* findings */}
      {s.kind === 'security' && (
        <>
          <SectionHead aside={openAll.length ? (filtered ? `${open.length} of ${openAll.length} open` : `${openAll.length} open`) : undefined}>Findings, in the order we would fix them</SectionHead>
          <FindingFilters items={openAll} value={filters} onChange={(v) => navigate({ search: v, replace: true, resetScroll: false })} />
          <div className="mt-8 space-y-16">
            {openAll.length === 0 && !live && <Empty>No open findings. Nothing here needs your attention.</Empty>}
            {openAll.length > 0 && open.length === 0 && (
              <p className="text-[17px] italic text-muted">
                No open findings match.{' '}
                <button className="not-italic font-sans text-[13px] underline underline-offset-4 hover:text-ink" onClick={() => navigate({ search: {}, replace: true, resetScroll: false })}>
                  Clear filters
                </button>
              </p>
            )}
            {open.map((f, i) => {
              const trace = parseList(f.trace_json)
              return (
                <section key={f.id} id={`f-${f.id}`} className="relative scroll-mt-8 border-t border-rule pt-6">
                  <p className="flex flex-wrap items-baseline gap-x-2 font-sans text-[12px] uppercase tracking-[0.16em] text-muted">
                    <span>№{f.priority ?? i + 1}</span>·<Severity severity={f.severity} />·<span>{f.category}</span>
                    {f.source && (
                      <>
                        ·<span className="normal-case tracking-normal">{SOURCE_LABEL[f.source] ?? f.source}</span>
                      </>
                    )}
                  </p>
                  <h3 className="mt-1.5 font-display text-[30px] leading-[1.15]">{f.title}</h3>
                  <p className="mt-1 font-sans text-[13px] text-muted">
                    {f.file && (
                      <>
                        <span className="font-mono">
                          {f.file}
                          {f.line ? `:${f.line}` : ''}
                        </span>{' '}
                        ·{' '}
                      </>
                    )}
                    <Verdict verdict={f.verdict} /> {f.confidence && <>· {f.confidence} confidence</>}
                  </p>
                  {f.threat_model && <p className="mt-3 text-[19px] italic leading-[1.5]">{f.threat_model}</p>}
                  <p className="mt-3 whitespace-pre-line text-[18px] leading-[1.6] text-ink-2">{f.description}</p>
                  {trace.length > 0 && (
                    <ol className="mt-3 space-y-1 border-l border-ink/20 pl-4 font-mono text-[12.5px] leading-relaxed text-ink-3">
                      {trace.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ol>
                  )}
                  {f.impact && (
                    <p className="mt-3 text-[18px] leading-[1.6]">
                      <span className="italic">Impact. </span>
                      {f.impact}
                    </p>
                  )}
                  {f.recommendation && (
                    <p className="mt-3 text-[18px] leading-[1.6]">
                      <span className="italic">The fix. </span>
                      {f.recommendation}
                    </p>
                  )}
                  {f.poc && (
                    <>
                      <p className="label mt-4">Proof of concept</p>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap bg-wash p-4 font-mono text-[12px] leading-relaxed text-ink-2">{f.poc}</pre>
                    </>
                  )}
                  {f.verification &&
                    (f.verification.length <= 320 ? (
                      <Margin>
                        <span className="label block">Validator</span>
                        <span className="mt-1 block whitespace-pre-line">{f.verification}</span>
                      </Margin>
                    ) : (
                      // Long notes would run past the section in the margin; set them inline instead.
                      <div className="mt-4 border-l border-gold pl-4 font-sans text-[13px] leading-relaxed text-muted">
                        <span className="label block">Validator</span>
                        <span className="mt-1 block whitespace-pre-line">{f.verification}</span>
                      </div>
                    ))}
                  <p className="mt-4 flex gap-4 font-sans text-[12.5px] text-muted">
                    {(['fixed', 'dismissed'] as const).map((st) => (
                      <button
                        key={st}
                        className="underline underline-offset-4 hover:text-ink"
                        onClick={async () => {
                          await updateFindingStatus({ data: { id: f.id, status: st } })
                          await router.invalidate()
                        }}
                      >
                        {st === 'fixed' ? 'Mark fixed' : 'Not a problem'}
                      </button>
                    ))}
                  </p>
                </section>
              )
            })}
          </div>

          {closed.length > 0 && (
            <>
              <SectionHead hint="Findings that are no longer open: rejected by the independent validator, dismissed by you, or marked fixed.">Set aside</SectionHead>
              <p className="mt-3 text-[17px] leading-[1.6] text-ink-3">Rejected by the validator, dismissed by you, or fixed. Kept so you can check the reasoning.</p>
              <ul className="mt-5 divide-y divide-rule text-[16px] leading-[1.45]">
                {closed.map((f) => (
                  <li key={f.id} className="py-4 first:pt-0 last:pb-0">
                    <span className="text-muted line-through decoration-ink/40">{f.title}.</span>{' '}
                    <span className="font-sans text-[12px] uppercase tracking-[0.12em] text-muted">{f.status === 'open' ? f.verdict : f.status}</span>
                    {f.verification && <span className="mt-0.5 block whitespace-pre-line text-ink-3">{f.verification}</span>}
                    {f.status !== 'open' && (
                      <button
                        className="mt-0.5 block font-sans text-[12px] text-muted underline underline-offset-4 hover:text-ink"
                        onClick={async () => {
                          await updateFindingStatus({ data: { id: f.id, status: 'open' } })
                          await router.invalidate()
                        }}
                      >
                        reopen
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {d.questions.length > 0 && (
        <>
          <SectionHead hint="Questions this scan raised about the product. Answers become product memory, so later scans don’t ask again.">Questions raised while reading</SectionHead>
          <QuestionList className="mt-6">
            {d.questions.map((q) => (
              <QuestionCard key={q.id} q={q} />
            ))}
          </QuestionList>
        </>
      )}

      {/* colophon */}
      <footer className="mt-20 border-t border-rule pt-6 font-sans text-[12.5px] leading-relaxed text-muted">
        {d.skills.length > 0 && (
          <p>
            <span className="uppercase tracking-[0.18em]">Colophon.</span> Methods applied in this review:{' '}
            {d.skills.map((id, i) => {
              const sk = SKILL_BY_ID[id]
              if (!sk) return null
              return (
                <span key={id}>
                  {i > 0 && ', '}
                  <a href={sk.repoUrl} target="_blank" rel="noreferrer" title={sk.howUsed} className="underline decoration-ink/25 underline-offset-2 hover:text-ink">
                    {sk.name}
                  </a>{' '}
                  ({sk.publisher})
                </span>
              )
            })}
            .{' '}
            <Link to="/skills" className="underline underline-offset-2 hover:text-ink">
              How each method is used
            </Link>
            .
          </p>
        )}
        <details className="mt-4">
          <summary className="cursor-pointer hover:text-ink">
            Activity log ({d.events.length} entries) · scan {s.id}
          </summary>
          <ol className="mt-3 max-h-80 space-y-1 overflow-y-auto font-mono text-[11.5px]">
            {d.events.map((e) => (
              <li key={e.id} className={e.level === 'error' ? 'text-alarm' : e.level === 'warn' ? 'text-amber' : ''}>
                <span className="text-faint">{new Date(e.ts).toLocaleTimeString()}</span> {e.message}
              </li>
            ))}
          </ol>
        </details>
        <p className="mt-4">
          <Link to="/home" className="underline underline-offset-2 hover:text-ink">
            ← Back to the brief
          </Link>{' '}
          · started {timeAgo(s.created_at)}
        </p>
      </footer>
    </Page>
  )
}
