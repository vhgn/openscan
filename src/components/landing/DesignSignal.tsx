import type { LandingProps } from './types'

const mono = 'font-mono'

function Line({ tag, color, children }: { tag: string; color: string; children: React.ReactNode }) {
  return (
    <p className="flex gap-3">
      <span className={`w-[86px] shrink-0 ${color}`}>[{tag}]</span>
      <span className="text-[#c9d1d9]">{children}</span>
    </p>
  )
}

/**
 * Option A — "Signal": dark, operator-console aesthetic. Leads with a live scan
 * session where most candidates are disproven before they reach you.
 */
export function DesignSignal({ cta, secondary }: LandingProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05070a] text-[#e6edf3]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_40%_at_70%_0%,rgba(52,211,153,0.16),transparent),radial-gradient(40%_30%_at_0%_30%,rgba(56,189,248,0.08),transparent)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:100%_4px]" />

      <nav className={`relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5 ${mono} text-xs`}>
        <span className="flex items-center gap-1 text-sm font-semibold text-emerald-300">
          <span className="text-[#5f6b78]">~/</span>openscan<span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-emerald-300" />
        </span>
        <div className="hidden items-center gap-6 text-[#7d8590] md:flex">
          <span>recon</span>
          <span>hunt</span>
          <span>validate</span>
          <span>brief</span>
        </div>
        <a href={cta.href} className="rounded border border-emerald-400/40 px-3 py-1.5 text-emerald-200 hover:bg-emerald-400/10">
          {cta.label} →
        </a>
      </nav>

      <section className="relative mx-auto grid max-w-6xl gap-12 px-6 pb-16 pt-12 lg:grid-cols-[1fr_1.08fr] lg:pt-16">
        <div>
          <p className={`mb-5 ${mono} text-xs uppercase tracking-[0.2em] text-emerald-300/80`}>
            <span className="text-[#5f6b78]">$</span> continuous AI pentest · GitHub App
          </p>
          <h1 className="text-4xl font-extrabold leading-[1.04] tracking-tight sm:text-6xl">
            Every finding
            <br />
            was attacked
            <br />
            <span className="bg-gradient-to-r from-emerald-300 to-sky-300 bg-clip-text text-transparent">before you saw it.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-[#9aa7b4]">
            openscan hunts your repositories like a red team, then hands every candidate to a second, independent agent whose only job is to disprove it.
            What survives gets a severity, a source trace and a fix. The rest is shown with the reasoning for dismissing it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={cta.href} className="rounded-md bg-emerald-400 px-5 py-3 font-semibold text-[#04130c] shadow-[0_0_44px_-8px_rgba(52,211,153,0.85)] hover:bg-emerald-300">
              {cta.label}
            </a>
            {secondary && (
              <a href={secondary.href} className={`px-3 py-3 ${mono} text-sm text-[#9aa7b4] hover:text-white`}>
                {secondary.label} ↓
              </a>
            )}
          </div>
          <dl className={`mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-white/10 pt-6 ${mono}`}>
            {[
              ['read-only', 'GitHub access'],
              ['0', 'API keys: runs on your ChatGPT'],
              ['1 page', 'brief for leadership'],
            ].map(([v, k]) => (
              <div key={k}>
                <dt className="text-lg font-semibold text-white">{v}</dt>
                <dd className="mt-1 text-[11px] leading-snug text-[#7d8590]">{k}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#0b0f14]/90 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-1.5 border-b border-white/5 px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
            <span className={`ml-3 ${mono} text-[11px] text-[#5f6b78]`}>openscan — acme/payments-api — sample session</span>
          </div>
          <div className={`space-y-1.5 p-5 ${mono} text-[12.5px] leading-relaxed`}>
            <p className="text-[#5f6b78]">$ openscan scan acme/payments-api --depth=deep</p>
            <Line tag="recon" color="text-sky-300">3 principals · 41 entry points · 2 trust boundaries</Line>
            <Line tag="signals" color="text-sky-300">612 deps · node:20.11 is EOL (CVE-2026-111497)</Line>
            <Line tag="hunt" color="text-amber-300">14 candidates from AI review + static rules</Line>
            <Line tag="validate" color="text-rose-300">
              <span className="text-rose-300">✗ 9 rejected</span> <span className="text-[#7d8590]">controls found upstream</span>
            </Line>
            <Line tag="validate" color="text-amber-300">
              <span className="text-amber-300">? 2 need input</span> <span className="text-[#7d8590]">asked your team</span>
            </Line>
            <Line tag="validate" color="text-emerald-300">
              <span className="text-emerald-300">✓ 3 confirmed</span>
            </Line>
            <Line tag="brief" color="text-emerald-300">3 actions · ~1 engineer-day · report ready</Line>

            <div className="mt-4 rounded-lg border border-red-400/25 bg-red-400/[0.06] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-red-300">HIGH · Stripe webhook signature never verified</p>
                <span className="rounded bg-emerald-500 px-1.5 text-[10px] font-bold text-black">✓ VERIFIED</span>
              </div>
              <p className="mt-2 text-[#9aa7b4]">attacker → POST /webhooks/stripe → handlers/stripe.ts:18 → invoices.markPaid()</p>
              <p className="mt-1 text-[#7d8590]">gates: reachability ✓ impact ✓ no upstream control ✓</p>
            </div>
            <div className="rounded-lg border border-white/10 p-3 text-[#7d8590]">
              <p className="line-through decoration-rose-400/60">MED · SQL injection in reports/query.ts:44</p>
              <p className="mt-1">rejected: value bound by ORM parameter at db.ts:12</p>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="relative border-t border-white/5">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <p className={`${mono} text-xs uppercase tracking-[0.2em] text-[#7d8590]`}>// the pipeline</p>
          <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['01', 'recon', 'Maps principals, entry points and trust boundaries before judging anything. Questions it can\'t answer from code go to your team.'],
              ['02', 'hunt', 'AI review plus deterministic checks: dependency CVEs, runtime EOL, CI pipelines that run AI agents.'],
              ['03', 'validate', 'A fresh agent tries to refute each finding: is it reachable, is the impact real, is there a control upstream?'],
              ['04', 'brief', 'Ranked fix plan for leads, a one-page posture brief for the CTO, and a PoC for every serious issue.'],
            ].map(([n, t, d]) => (
              <div key={n} className="bg-[#05070a] p-6">
                <p className={`${mono} text-sm text-emerald-300`}>
                  {n} <span className="text-white">{t}</span>
                </p>
                <p className="mt-3 text-sm text-[#9aa7b4]">{d}</p>
              </div>
            ))}
          </div>
          <p className={`mt-6 ${mono} text-[11px] text-[#5f6b78]`}>
            methodology built on open-source security skills published by Trail of Bits, Cloudflare, Anthropic, NVIDIA, Cognition and OpenAI
          </p>
        </div>
      </section>
    </div>
  )
}
