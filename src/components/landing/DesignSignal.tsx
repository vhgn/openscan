import type { LandingProps } from './types'

/** Option A — "Signal": dark, terminal-flavoured, shows the triage output as the hero. */
export function DesignSignal({ cta, secondary }: LandingProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#07090c] text-[#e6edf3]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(52,211,153,0.18),transparent)]" />
      <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="font-mono text-sm font-semibold tracking-tight text-emerald-300">openscan</span>
        <a href={cta.href} className="rounded-md border border-emerald-400/30 px-3 py-1.5 font-mono text-xs text-emerald-200 hover:bg-emerald-400/10">
          {cta.label} →
        </a>
      </nav>

      <section className="relative mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-12 lg:grid-cols-[1.1fr_1fr] lg:pt-20">
        <div>
          <p className="mb-5 font-mono text-xs uppercase tracking-[0.2em] text-emerald-300/80">AI security review · GitHub App</p>
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Less noise.
            <br />
            <span className="text-emerald-300">The three things</span>
            <br />
            worth fixing today.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-[#9aa7b4]">
            Install the app, pick repositories, and an agent reads your code like a new senior engineer would — asking questions, answering most of them
            itself, and turning findings into a short, ranked plan.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={cta.href} className="rounded-md bg-emerald-400 px-5 py-3 font-semibold text-[#07130d] shadow-[0_0_40px_-8px_rgba(52,211,153,0.8)] hover:bg-emerald-300">
              {cta.label}
            </a>
            {secondary && (
              <a href={secondary.href} className="px-3 py-3 font-mono text-sm text-[#9aa7b4] hover:text-white">
                {secondary.label}
              </a>
            )}
          </div>
          <p className="mt-4 font-mono text-xs text-[#5f6b78]">Inference runs on your own ChatGPT plan. No API keys.</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#0d1117] p-1 shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-white/5 px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
            <span className="ml-3 font-mono text-[11px] text-[#5f6b78]">acme/payments-api · report</span>
          </div>
          <div className="space-y-4 p-5 font-mono text-[13px] leading-relaxed">
            <p className="text-[#5f6b78]">$ openscan --depth=deep</p>
            <p>
              <span className="text-emerald-300">✓</span> read 41 files · checked 612 deps · <span className="text-amber-300">2 questions for you</span>
            </p>
            <div className="rounded-lg border border-red-400/20 bg-red-400/5 p-3">
              <p className="text-red-300">1 · HIGH  Webhook signature not verified</p>
              <p className="text-[#9aa7b4]">src/routes/stripe.ts:18 → anyone can mark invoices paid</p>
            </div>
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
              <p className="text-amber-300">2 · MED   jsonwebtoken@8.5.1 (CVE-2022-23529)</p>
              <p className="text-[#9aa7b4]">upgrade to ≥ 9.0.0 · reachable from /auth</p>
            </div>
            <p className="text-[#9aa7b4]">
              <span className="text-emerald-300">next →</span> verify signatures with the raw body (≈15 min)
            </p>
          </div>
        </div>
      </section>

      <section className="relative border-t border-white/5">
        <div className="mx-auto grid max-w-6xl gap-px overflow-hidden px-6 py-16 sm:grid-cols-3">
          {[
            ['01 · Understands first', 'Builds a profile of your stack, data stores and trust boundaries before judging anything.'],
            ['02 · Asks, then answers', 'Raises the questions a reviewer would — and resolves most by reading further.'],
            ['03 · Tells you what to do', 'Ranked risks, plain-language impact, a fix order. Optional PoC for each serious issue.'],
          ].map(([t, d]) => (
            <div key={t} className="p-6">
              <p className="font-mono text-sm text-emerald-300">{t}</p>
              <p className="mt-2 text-[#9aa7b4]">{d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
