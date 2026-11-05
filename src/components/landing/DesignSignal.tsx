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

      {/* Hero: one terminal window, tmux-style (shell pane + live scan pane + status bar) */}
      <section className="relative mx-auto max-w-6xl px-6 pb-16 pt-8 lg:pt-12">
        <div className={`overflow-hidden rounded-lg border border-white/10 bg-[#0b0f14] shadow-[0_0_80px_-20px_rgba(52,211,153,0.35)] ${mono}`}>
          {/* title bar with tabs */}
          <div className="flex items-center gap-2 border-b border-white/10 bg-[#0d1218] px-3 py-2 text-[11px]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
            <span className="ml-3 rounded-t border-x border-t border-white/10 bg-[#0b0f14] px-3 py-0.5 text-emerald-300">zsh — openscan</span>
            <span className="px-2 text-[#5f6b78]">acme/payments-api</span>
            <span className="ml-auto hidden text-[#5f6b78] sm:inline">ssh cto@acme · 120×38</span>
          </div>

          <div className="grid lg:grid-cols-[1.05fr_1fr]">
            {/* left pane: the pitch, as a shell session */}
            <div className="border-b border-white/10 p-5 text-[13px] leading-relaxed sm:p-7 lg:border-b-0 lg:border-r">
              <p className="text-[#5f6b78]">
                Last login: Thu Nov 5 09:41 on ttys001 <span className="text-[#3d4651]">· continuous AI pentest via GitHub App</span>
              </p>
              <p className="mt-4">
                <span className="text-emerald-300">cto@acme</span>
                <span className="text-[#5f6b78]">:</span>
                <span className="text-sky-300">~</span>
                <span className="text-[#5f6b78]">$</span> openscan --why
              </p>
              <h1 className="mt-4 text-[34px] font-semibold leading-[1.08] tracking-tight text-[#e6edf3] sm:text-5xl">
                <span className="text-[#5f6b78]">&gt; </span>Every finding
                <br />
                <span className="text-[#5f6b78]">&gt; </span>was attacked
                <br />
                <span className="text-[#5f6b78]">&gt; </span>
                <span className="text-emerald-300">before you saw it.</span>
                <span className="ml-1 inline-block h-[0.85em] w-[0.5em] translate-y-[3px] animate-pulse bg-emerald-300" />
              </h1>
              <div className="mt-6 space-y-1 text-[#7d8590]">
                <p># hunts your repos like a red team</p>
                <p># hands every candidate to a second agent whose only job is to disprove it</p>
                <p># survivors get a severity, a source trace and a fix; the rest show why they were dismissed</p>
              </div>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <a href={cta.href} className="group inline-flex items-center gap-3 rounded border border-emerald-400/60 bg-emerald-400/10 px-4 py-2.5 text-emerald-200 shadow-[0_0_30px_-10px_rgba(52,211,153,0.9)] hover:bg-emerald-400 hover:text-[#04130c]">
                  <span className="text-emerald-400 group-hover:text-[#04130c]">$</span> openscan connect --github
                  <span className="rounded border border-current px-1.5 text-[10px] opacity-70">↵ enter</span>
                </a>
                {secondary && (
                  <a href={secondary.href} className="text-[#7d8590] hover:text-white">
                    man openscan ↓
                  </a>
                )}
              </div>
              <p className="mt-2 text-[11px] text-[#5f6b78]">
                ({cta.label})
              </p>

              <dl className="mt-7 grid max-w-md grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-white/10 pt-4 text-[12px]">
                {[
                  ['access', 'read-only GitHub App'],
                  ['inference', "your ChatGPT plan · 0 API keys"],
                  ['output', '1-page brief for leadership'],
                ].map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-sky-300">{k}:</dt>
                    <dd className="text-[#c9d1d9]">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* right pane: live scan session */}
            <div className="space-y-1.5 bg-[#090d12] p-5 text-[12.5px] leading-relaxed sm:p-7">
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

              <div className="mt-4 rounded border border-red-400/25 bg-red-400/[0.06] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-red-300">HIGH · Stripe webhook signature never verified</p>
                  <span className="rounded bg-emerald-500 px-1.5 text-[10px] font-bold text-black">✓ VERIFIED</span>
                </div>
                <p className="mt-2 text-[#9aa7b4]">attacker → POST /webhooks/stripe → handlers/stripe.ts:18 → invoices.markPaid()</p>
                <p className="mt-1 text-[#7d8590]">gates: reachability ✓ impact ✓ no upstream control ✓</p>
              </div>
              <div className="rounded border border-white/10 p-3 text-[#7d8590]">
                <p className="line-through decoration-rose-400/60">MED · SQL injection in reports/query.ts:44</p>
                <p className="mt-1">rejected: value bound by ORM parameter at db.ts:12</p>
              </div>
              <p className="pt-2 text-[#5f6b78]">
                $ <span className="inline-block h-[1em] w-[0.55em] translate-y-[2px] animate-pulse bg-[#c9d1d9]" />
              </p>
            </div>
          </div>

          {/* tmux-style status bar */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-emerald-400 px-3 py-1 text-[11px] text-[#04130c]">
            <span className="font-semibold">[openscan]</span>
            <span>0:recon</span>
            <span>1:hunt</span>
            <span className="rounded bg-[#04130c] px-1.5 text-emerald-300">2:validate*</span>
            <span>3:brief</span>
            <span className="ml-auto hidden sm:inline">⎇ main · 3 verified · 2 need input</span>
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
