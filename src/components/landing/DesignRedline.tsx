import type { LandingProps } from './types'

const grid =
  'bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px]'

/** Option C — "Redline": offensive-security dossier. Reads like a pentest engagement report written for leadership. */
export function DesignRedline({ cta, secondary }: LandingProps) {
  return (
    <div className={`relative min-h-screen overflow-hidden bg-[#090909] font-sans text-[#e8e6e3] ${grid}`}>
      {/* scanlines */}
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.25)_0px,rgba(0,0,0,0.25)_1px,transparent_1px,transparent_3px)] opacity-40" />
      <div className="pointer-events-none absolute -right-32 -top-32 h-[460px] w-[460px] rounded-full bg-red-600/20 blur-[140px]" />

      <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5 font-mono text-xs">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-widest">
          <span className="inline-block h-2 w-2 bg-red-500 shadow-[0_0_12px_#ef4444]" /> openscan
        </span>
        <span className="hidden text-[#7d7973] md:inline">[ ATTACK-PATH ANALYSIS · PoC EVIDENCE · LEADERSHIP BRIEFS ]</span>
        <a href={cta.href} className="border border-red-500/60 px-3 py-1.5 uppercase tracking-widest text-red-300 hover:bg-red-500 hover:text-black">
          {cta.label}
        </a>
      </nav>

      <section className="relative mx-auto max-w-6xl px-6 pb-14 pt-14 lg:pt-20">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-red-400">
          <span className="text-[#7d7973]">// </span>engagement: continuous · scope: your repositories
        </p>
        <h1 className="mt-6 max-w-5xl text-4xl font-extrabold uppercase leading-[0.98] tracking-tight sm:text-6xl lg:text-7xl">
          We read your code
          <br />
          like an attacker.
          <br />
          <span className="text-red-500">We brief you like a CISO.</span>
        </h1>
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <p className="max-w-2xl text-lg leading-relaxed text-[#a8a39c]">
            An AI red-teamer that maps how your product actually works, chains weaknesses into real attack paths, proves the serious ones with a
            reproducible PoC — and hands engineering leadership a one-page risk brief with a fix order that fits the next sprint.
          </p>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <a href={cta.href} className="group inline-flex items-center gap-3 bg-red-600 px-6 py-3.5 font-mono text-sm font-bold uppercase tracking-widest text-black hover:bg-red-500">
              <span className="text-black/60 group-hover:text-black">&gt;_</span> {cta.label}
            </a>
            {secondary && (
              <a href={secondary.href} className="font-mono text-xs uppercase tracking-widest text-[#7d7973] hover:text-white">
                {secondary.label} ↓
              </a>
            )}
            <p className="font-mono text-[11px] text-[#5d5a55]">read-only GitHub App · inference on your own ChatGPT plan · no API keys</p>
          </div>
        </div>
      </section>

      {/* Dossier */}
      <section className="relative mx-auto max-w-6xl px-6 pb-16">
        <div className="border border-white/10 bg-black/60 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-5 py-3 font-mono text-[11px] uppercase tracking-widest">
            <span className="text-[#7d7973]">
              report <span className="text-[#e8e6e3]">#0x2F1A</span> · target <span className="text-[#e8e6e3]">acme/billing-api</span> @ 9c41e07
            </span>
            <span className="bg-red-600 px-2 py-0.5 font-bold text-black">overall risk: high</span>
          </div>
          <div className="grid lg:grid-cols-[1.35fr_1fr]">
            <div className="border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
              <p className="font-mono text-[11px] uppercase tracking-widest text-red-400">attack path · AP-01 · critical</p>
              <pre className="mt-3 overflow-x-auto font-mono text-[12px] leading-6 text-[#cfcac3]">{`[ internet ]
     │  POST /webhooks/stripe        ✗ signature never verified
     ▼
[ handlers/stripe.ts:18 ]
     │  invoice.markPaid(evt.id)     ✗ trusts client-supplied id
     ▼
[ postgres.invoices ]  ─────▶  any invoice → "paid"   impact: revenue loss`}</pre>
              <div className="mt-4 border-l-2 border-red-500 bg-red-500/5 px-3 py-2 font-mono text-[12px] text-[#cfcac3]">
                <span className="text-red-400">PoC</span> curl -X POST $HOST/webhooks/stripe -d @forged_invoice_paid.json → 200 OK
                <br />
                <span className="text-emerald-400">verify-fix</span> same request must return 400 once stripe.webhooks.constructEvent() is enforced
              </div>
            </div>
            <div className="p-5">
              <p className="font-mono text-[11px] uppercase tracking-widest text-[#7d7973]">brief for leadership</p>
              <ol className="mt-3 space-y-3 text-sm">
                {[
                  ['Fix now', 'Forged webhooks can mark invoices paid.', '½ day'],
                  ['This sprint', 'jsonwebtoken 8.5.1 is exploitable from /auth.', '1 h'],
                  ['Track', 'CI uses pull_request_target with secrets.', '2 h'],
                ].map(([when, what, effort], i) => (
                  <li key={what} className="flex gap-3">
                    <span className="font-mono text-red-500">0{i + 1}</span>
                    <span className="flex-1">
                      <span className="font-mono text-[11px] uppercase tracking-widest text-[#7d7973]">{when}</span>
                      <span className="block text-[#e8e6e3]">{what}</span>
                    </span>
                    <span className="font-mono text-xs text-[#7d7973]">{effort}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 border-t border-white/10 pt-3 font-mono text-[11px] text-[#7d7973]">
                41 files read · 612 deps checked · 14 raw alerts → 3 that matter · 2 questions for your team
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Kill chain */}
      <section id="how" className="relative border-t border-white/10">
        <div className="mx-auto grid max-w-6xl gap-px px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['01', 'Recon', 'Reads the repo to map stack, entry points, data stores and trust boundaries.'],
            ['02', 'Interrogate', 'Raises the questions a pentester would ask — and answers most from the code itself.'],
            ['03', 'Exploit', 'Chains weaknesses into attack paths. Serious ones get a PoC your team can reproduce.'],
            ['04', 'Brief', 'Daily, weekly or on every push: a ranked fix plan for leads, and a one-pager for the CTO.'],
          ].map(([n, t, d]) => (
            <div key={n} className="p-5">
              <p className="font-mono text-xs text-red-500">
                {n} <span className="text-[#5d5a55]">────</span>
              </p>
              <p className="mt-2 font-mono text-sm font-bold uppercase tracking-widest">{t}</p>
              <p className="mt-2 text-sm text-[#a8a39c]">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative border-t border-white/10">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-14 md:grid-cols-3">
          {[
            ['For the CTO', 'Risk posture in one page. What could hurt the business, and whether it is trending down.'],
            ['For team leads', 'A fix order with effort estimates that drops straight into sprint planning.'],
            ['For engineers', 'File, line, attack path, PoC and the exact fix. No 400-row CSV.'],
          ].map(([t, d]) => (
            <div key={t} className="border-l border-red-500/50 pl-4">
              <p className="font-mono text-xs uppercase tracking-widest text-red-400">{t}</p>
              <p className="mt-2 text-[#cfcac3]">{d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
