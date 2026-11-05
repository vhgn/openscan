import type { ReportData, ReportFinding } from './sample'

const serif = "font-['Newsreader',ui-serif,Georgia,serif]"
const display = "font-['Instrument_Serif',ui-serif,Georgia,serif]"
const sans = "font-['Inter',ui-sans-serif,system-ui,sans-serif]"
const mono = "font-['JetBrains_Mono',ui-monospace,monospace]"
const label = `${sans} text-[11px] uppercase tracking-[0.2em] text-[#6f6f6a]`
const squiggle = 'underline decoration-[#e3c98b] decoration-wavy decoration-2 underline-offset-[6px] [text-decoration-skip-ink:none]'

function VerdictWord({ v }: { v: ReportFinding['verdict'] }) {
  if (v === 'confirmed') return <span className={`italic ${squiggle}`}>verified</span>
  if (v === 'needs_validation') return <span className="italic text-[#8a6d1f]">needs your answer</span>
  return <span className="italic text-[#6f6f6a]">unverified</span>
}

function Margin({ children }: { children: React.ReactNode }) {
  return <aside className={`${sans} mt-2 text-[12.5px] leading-snug text-[#6f6f6a] lg:absolute lg:left-[calc(100%+2.5rem)] lg:top-1 lg:mt-0 lg:w-52`}>{children}</aside>
}

/** Static sample of the brief (for /design and the landing page's sample link). */
export function ReportEssay({ data }: { data: ReportData }) {
  const s = data.scan
  return (
    <div className={`min-h-screen bg-[#fbfbf9] text-[#141414] ${serif}`}>
      {/* signed-in masthead */}
      <header className="border-b border-[#141414]/10">
        <nav className={`mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 ${sans} text-[13px]`}>
          <span className={`${display} text-[24px]`}>openscan</span>
          <span className="text-[#6f6f6a]">/</span>
          <span className="font-medium">{data.product.name}</span>
          <span className="ml-auto hidden gap-5 text-[#4a4a46] sm:flex">
            <span>Reports</span>
            <span>Questions</span>
            <span>Memory</span>
            <span>Skills</span>
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#141414] text-[11px] font-semibold text-[#fbfbf9]">{data.user.initials}</span>
        </nav>
      </header>

      <article className="mx-auto max-w-5xl px-6 pb-24 pt-12">
        <div className="max-w-[42rem]">
          <p className={label}>
            Security brief · {s.repo} · {s.trigger}
          </p>
          <p className={`${sans} mt-2 text-[13px] text-[#6f6f6a]`}>
            {s.date} · commit <span className={mono}>{s.commit}</span> on {s.branch} · reviewed by {s.engine}
          </p>
          <h1 className={`${display} mt-6 text-[44px] leading-[1.05] sm:text-[60px]`} style={{ textWrap: 'balance' }}>
            {s.headline}
          </h1>
          <p className="mt-6 text-[19px] leading-[1.65] text-[#2b2b28]">
            Overall risk is <span className={`italic ${squiggle}`}>{s.risk}</span>. Of fourteen candidate issues, an independent validator confirmed{' '}
            {s.validation.confirmed}, rejected {s.validation.rejected}, and left {s.validation.needs_validation} for you to decide. We read {s.filesReviewed} files
            and checked {s.dependenciesChecked} dependencies; product memory let us skip {s.memory.skippedFiles} files that had not changed since last week.
          </p>

          <h2 className={`${label} mt-14`}>What matters</h2>
          <ul className="mt-4 space-y-3 text-[19px] leading-[1.6]">
            {data.whatMatters.map((m) => (
              <li key={m} className="grid grid-cols-[1.25rem_1fr]">
                <span className="text-[#b9a46a]">—</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>

          <h2 className={`${label} mt-14`}>What to do this week</h2>
          <ol className="mt-4 space-y-5 text-[19px] leading-[1.6]">
            {data.nextActions.map((a, i) => (
              <li key={a.action} className="relative grid grid-cols-[1.75rem_1fr]">
                <span className={`${display} text-[24px] leading-none`}>{i + 1}.</span>
                <span>
                  {a.action} <span className="text-[#4a4a46]">{a.why}</span>
                </span>
                <Margin>Effort: {a.effort}</Margin>
              </li>
            ))}
          </ol>

          <h2 className={`${label} mt-16`}>Findings, in the order we would fix them</h2>
          <div className="mt-6 space-y-12">
            {data.findings.map((f) => (
              <section key={f.id} className="relative border-t border-[#141414]/12 pt-6">
                <p className={`${sans} text-[12px] uppercase tracking-[0.16em] text-[#6f6f6a]`}>
                  №{f.priority} · {f.severity} · {f.category} · <span className="normal-case tracking-normal">{f.source}</span>
                </p>
                <h3 className={`${display} mt-2 text-[30px] leading-[1.15]`}>{f.title}</h3>
                <p className={`${sans} mt-1 text-[13px] text-[#6f6f6a]`}>
                  <span className={mono}>
                    {f.file}
                    {f.line ? `:${f.line}` : ''}
                  </span>{' '}
                  · <VerdictWord v={f.verdict} />
                </p>
                {f.threatModel && <p className="mt-4 text-[19px] italic leading-[1.55]">{f.threatModel}</p>}
                <p className="mt-3 text-[18px] leading-[1.65] text-[#2b2b28]">{f.description}</p>
                {f.trace && (
                  <ol className={`${mono} mt-4 space-y-1 border-l border-[#141414]/20 pl-4 text-[12.5px] leading-relaxed text-[#3a3a37]`}>
                    {f.trace.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ol>
                )}
                <p className="mt-4 text-[18px] leading-[1.65]">
                  <span className="italic">The fix. </span>
                  {f.fix}
                </p>
                {f.poc && (
                  <pre className={`${mono} mt-4 overflow-x-auto bg-[#f1f1ec] p-4 text-[12px] leading-relaxed text-[#2b2b28]`}>{f.poc}</pre>
                )}
                {(f.verification || f.effort) && (
                  <Margin>
                    {f.effort && <span className="block">Effort: {f.effort}</span>}
                    {f.verification && <span className="mt-1 block">{f.verification}</span>}
                  </Margin>
                )}
              </section>
            ))}
          </div>

          <h2 className={`${label} mt-16`}>Set aside</h2>
          <p className="mt-3 text-[17px] leading-[1.6] text-[#4a4a46]">The validator tried to prove these and could not. Kept here so you can check its reasoning.</p>
          <ul className="mt-4 space-y-2 text-[16px] leading-[1.55]">
            {data.rejected.map((r) => (
              <li key={r.title}>
                <span className="text-[#6f6f6a] line-through decoration-[#141414]/40">{r.title}.</span> <span className="text-[#4a4a46]">{r.reason}</span>
              </li>
            ))}
          </ul>

          <h2 className={`${label} mt-16`}>Questions for you</h2>
          <div className="mt-4 space-y-6">
            {data.questions.map((q) => (
              <div key={q.question}>
                <p className="text-[19px] leading-[1.5]">{q.question}</p>
                <p className={`${sans} mt-1 text-[13px] text-[#6f6f6a]`}>{q.why}</p>
                {q.status === 'open' ? (
                  <div className={`${sans} mt-3 flex flex-wrap gap-2`}>
                    <span className="min-w-[16rem] flex-1 border-b border-[#141414]/40 pb-1 text-[15px] text-[#9a9a94]">Your answer…</span>
                    <span className="bg-[#141414] px-4 py-1.5 text-[13px] font-semibold text-[#fbfbf9]">Save</span>
                  </div>
                ) : (
                  <p className="mt-2 text-[17px] italic text-[#2b2b28]">
                    {q.answer} <span className={`${sans} not-italic text-[12px] text-[#6f6f6a]`}>({q.by === 'ai' ? 'answered by the AI from the code' : 'your answer'})</span>
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* colophon */}
          <footer className={`${sans} mt-20 border-t border-[#141414]/12 pt-6 text-[12.5px] leading-relaxed text-[#6f6f6a]`}>
            <p>
              <span className="uppercase tracking-[0.18em]">Colophon.</span> Reviewed in Codex Cloud by three agents: recon ({data.codexTasks[0].minutes} min), hunt (
              {data.codexTasks[1].minutes} min), validate ({data.codexTasks[2].minutes} min). Methods from {data.skills.map((k) => `${k.name} (${k.publisher})`).join(', ')}.
              Product memory reused {s.memory.reusedVerdicts} earlier verdicts on unchanged code. Scan {s.id}.
            </p>
          </footer>
        </div>
      </article>
    </div>
  )
}
