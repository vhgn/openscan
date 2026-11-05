import { rosette } from '../landing/guilloche'
import type { ReportData, ReportFinding } from './sample'

const ink = '#d7f5e6'
const serif = "font-['Cormorant_Garamond',ui-serif,Georgia,serif]"
const sans = "font-['Inter',ui-sans-serif,system-ui,sans-serif]"
const mono = "font-['JetBrains_Mono',ui-monospace,monospace]"
const small = `${sans} text-[10.5px] uppercase tracking-[0.22em] text-[#d7f5e6]/65`

function Microtext({ text }: { text: string }) {
  return (
    <div aria-hidden="true" className={`overflow-hidden whitespace-nowrap ${sans} text-[7px] uppercase tracking-[0.25em] text-[#d7f5e6]/40`}>
      {text.repeat(16)}
    </div>
  )
}

function Stamp({ v }: { v: ReportFinding['verdict'] }) {
  const map = {
    confirmed: ['Verified', 'border-[#d7f5e6] text-[#d7f5e6]'],
    needs_validation: ['Needs input', 'border-[#e9d48b] text-[#e9d48b]'],
    rejected: ['Void', 'border-[#d7f5e6]/40 text-[#d7f5e6]/40'],
  } as const
  const [text, cls] = v ? map[v] : ['Unverified', 'border-[#d7f5e6]/40 text-[#d7f5e6]/50']
  return <span className={`inline-block -rotate-3 border-2 border-double px-2 py-0.5 ${sans} text-[10px] font-semibold uppercase tracking-[0.25em] ${cls}`}>{text}</span>
}

/** The risk "denomination": guilloche rings around the overall risk, like a banknote's value seal. */
function RiskSeal({ risk }: { risk: string }) {
  return (
    <div className="relative aspect-square w-[220px] shrink-0">
      <svg viewBox="0 0 300 300" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <g fill="none" stroke={ink} strokeLinecap="round">
          <path d={rosette(150, 150, 130, 26, 30, 1200)} strokeWidth="0.5" opacity="0.7" />
          <path d={rosette(150, 150, 105, 21, 24, 1000, 0.2)} strokeWidth="0.45" opacity="0.55" />
          <circle cx="150" cy="150" r="138" strokeWidth="1.2" />
          <circle cx="150" cy="150" r="143" strokeWidth="0.5" />
          <circle cx="150" cy="150" r="70" strokeWidth="1" />
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className={small}>Overall risk</span>
        <span className={`${serif} text-[46px] font-medium uppercase leading-none`}>{risk}</span>
      </div>
    </div>
  )
}

/** Option C report page: the weekly brief as a certificate of review. */
export function ReportGuilloche({ data }: { data: ReportData }) {
  const s = data.scan
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0e4a3a] text-[#d7f5e6]">
      {/* signed-in nav */}
      <header className="border-b border-[#d7f5e6]/15">
        <nav className={`mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 ${sans} text-[11px] uppercase tracking-[0.22em]`}>
          <span className={`${serif} text-[26px] font-medium normal-case tracking-[0.04em]`}>openscan</span>
          <span className="text-[#d7f5e6]/70">{data.product.name}</span>
          <span className="ml-auto hidden gap-6 text-[#d7f5e6]/70 md:flex">
            <span>Reports</span>
            <span>Questions</span>
            <span>Memory</span>
            <span>Skills</span>
          </span>
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d7f5e6]/60 text-[10px] tracking-normal">{data.user.initials}</span>
        </nav>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="border border-[#d7f5e6]/50 p-1.5">
          <div className="border border-[#d7f5e6]/25 px-5 pb-10 pt-3 sm:px-10">
            <Microtext text={`openscan · certificate of review · ${s.repo} · ${s.commit} · `} />

            {/* certificate head */}
            <div className={`mt-4 flex flex-wrap items-baseline justify-between gap-2 ${small}`}>
              <span>Nº {s.id}</span>
              <span>Series 2026 · {s.trigger}</span>
            </div>
            <section className="mt-8 grid items-center gap-10 lg:grid-cols-[1fr_auto]">
              <div>
                <p className={small}>Certificate of security review</p>
                <h1 className={`${serif} mt-3 text-[44px] font-light leading-[1] sm:text-[64px]`}>{s.repo}</h1>
                <p className={`${serif} mt-6 max-w-2xl text-[26px] italic leading-[1.25] sm:text-[30px]`}>{s.headline}</p>
                <p className={`${sans} mt-5 text-[13px] text-[#d7f5e6]/70`}>
                  {s.date} · commit {s.commit} on {s.branch} · reviewed in {s.engine}
                </p>
              </div>
              <div className="flex items-center gap-6">
                <RiskSeal risk={s.risk} />
                <figure className="hidden w-[150px] shrink-0 lg:block">
                  <img src="/landing/apollo-dither.png" width={540} height={540} alt="" className="h-auto w-full opacity-80 [image-rendering:auto]" />
                </figure>
              </div>
            </section>

            {/* ledger of figures */}
            <dl className="mt-10 grid grid-cols-2 border-y border-[#d7f5e6]/25 sm:grid-cols-3 lg:grid-cols-6">
              {(
                [
                  ['Files read', s.filesReviewed],
                  ['Dependencies', s.dependenciesChecked],
                  ['Verified', s.validation.confirmed],
                  ['Needs input', s.validation.needs_validation],
                  ['Voided', s.validation.rejected],
                  ['Skipped (memory)', s.memory.skippedFiles],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="border-[#d7f5e6]/15 px-3 py-4 [&:not(:first-child)]:border-l">
                  <dt className={small}>{k}</dt>
                  <dd className={`${serif} mt-1 text-[34px] font-light leading-none`}>{v}</dd>
                </div>
              ))}
            </dl>

            {/* actions as perforated coupons */}
            <h2 className={`${serif} mt-12 text-[32px] font-light uppercase tracking-[0.06em]`}>To be redeemed this week</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {data.nextActions.map((a, i) => (
                <div key={a.action} className="border-2 border-dashed border-[#d7f5e6]/40 p-5">
                  <div className="flex items-baseline justify-between">
                    <span className={`${serif} text-[36px] italic leading-none`}>{['I', 'II', 'III'][i]}</span>
                    <span className={small}>{a.effort}</span>
                  </div>
                  <p className={`${serif} mt-3 text-[21px] leading-[1.25]`}>{a.action}</p>
                  <p className={`${sans} mt-2 text-[13px] text-[#d7f5e6]/70`}>{a.why}</p>
                </div>
              ))}
            </div>

            {/* findings */}
            <h2 className={`${serif} mt-14 text-[32px] font-light uppercase tracking-[0.06em]`}>Findings</h2>
            <div className="mt-5 divide-y divide-[#d7f5e6]/15 border-y border-[#d7f5e6]/25">
              {data.findings.map((f) => (
                <article key={f.id} className="grid gap-5 py-7 lg:grid-cols-[5rem_1fr_15rem]">
                  <div className={`${serif} text-[44px] font-light leading-none text-[#d7f5e6]/70`}>{String(f.priority).padStart(2, '0')}</div>
                  <div>
                    <p className={small}>
                      {f.severity} · {f.category} · {f.source}
                    </p>
                    <h3 className={`${serif} mt-2 text-[28px] leading-[1.15]`}>{f.title}</h3>
                    <p className={`${sans} mt-1 text-[12.5px] text-[#d7f5e6]/65`}>
                      {f.file}
                      {f.line ? `:${f.line}` : ''}
                    </p>
                    {f.threatModel && <p className={`${serif} mt-4 text-[20px] italic leading-[1.35]`}>{f.threatModel}</p>}
                    <p className={`${sans} mt-3 max-w-2xl text-[14px] leading-relaxed text-[#d7f5e6]/85`}>{f.description}</p>
                    {f.trace && (
                      <ol className={`${sans} mt-4 space-y-1 border-l border-[#d7f5e6]/30 pl-4 text-[12.5px] text-[#d7f5e6]/80`}>
                        {f.trace.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ol>
                    )}
                    <p className={`${sans} mt-4 max-w-2xl text-[14px] leading-relaxed`}>
                      <span className="uppercase tracking-[0.18em] text-[#d7f5e6]/60">Remedy · </span>
                      {f.fix}
                    </p>
                    {f.poc && <pre className={`${mono} mt-4 overflow-x-auto border border-[#d7f5e6]/20 bg-[#0a3b2e] p-4 text-[11.5px] leading-relaxed`}>{f.poc}</pre>}
                  </div>
                  <div className="space-y-3">
                    <Stamp v={f.verdict} />
                    {f.effort && <p className={small}>Effort {f.effort}</p>}
                    {f.verification && <p className={`${sans} text-[12px] leading-snug text-[#d7f5e6]/65`}>{f.verification}</p>}
                  </div>
                </article>
              ))}
            </div>

            {/* voided */}
            <h2 className={`${serif} mt-12 text-[26px] font-light uppercase tracking-[0.06em] text-[#d7f5e6]/80`}>Voided by the validator</h2>
            <ul className="mt-4 grid gap-3 md:grid-cols-3">
              {data.rejected.map((r) => (
                <li key={r.title} className="relative overflow-hidden border border-[#d7f5e6]/20 p-4">
                  <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top_right,transparent_calc(50%-0.5px),rgba(215,245,230,0.25)_50%,transparent_calc(50%+0.5px))]" />
                  <p className={`${serif} text-[19px] text-[#d7f5e6]/70`}>{r.title}</p>
                  <p className={`${sans} mt-1 text-[12px] text-[#d7f5e6]/55`}>{r.reason}</p>
                </li>
              ))}
            </ul>

            {/* questions as endorsements */}
            <h2 className={`${serif} mt-12 text-[32px] font-light uppercase tracking-[0.06em]`}>Endorsements required</h2>
            <div className="mt-5 grid gap-6 md:grid-cols-3">
              {data.questions.map((q) => (
                <div key={q.question}>
                  <p className={`${serif} text-[20px] leading-[1.3]`}>{q.question}</p>
                  <p className={`${sans} mt-1 text-[12px] text-[#d7f5e6]/60`}>{q.why}</p>
                  {q.status === 'open' ? (
                    <div className="mt-5">
                      <div className="border-b border-[#d7f5e6]/60 pb-1" />
                      <div className={`mt-1 flex justify-between ${small}`}>
                        <span>Owner's answer</span>
                        <span className="text-[#e9d48b]">Awaiting</span>
                      </div>
                    </div>
                  ) : (
                    <p className={`${sans} mt-3 text-[13px] text-[#d7f5e6]/85`}>
                      {q.answer} <span className="text-[#d7f5e6]/55">— {q.by === 'ai' ? 'settled by the AI from the code' : 'endorsed by you'}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className={`mt-12 flex flex-wrap items-center justify-between gap-3 ${small}`}>
              <span>
                Codex Cloud · {data.codexTasks.map((t) => `${t.role} ${t.minutes} min`).join(' · ')}
              </span>
              <span>Memory reused {s.memory.reusedVerdicts} verdicts</span>
            </div>
            <div className="mt-2">
              <Microtext text={`methods · ${data.skills.map((k) => `${k.name} (${k.publisher})`).join(' · ')} · `} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
