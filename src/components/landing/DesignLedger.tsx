import type { LandingProps } from './types'

/** Option B — "Ledger": light, editorial, the report as a document you'd forward to your CTO. */
export function DesignLedger({ cta, secondary }: LandingProps) {
  return (
    <div className="relative min-h-screen bg-[#f6f3ee] text-[#1d1b18]">
      <nav className="mx-auto flex max-w-5xl items-center justify-between border-b border-[#1d1b18]/15 px-6 py-5">
        <span className="font-serif text-xl font-bold">openscan</span>
        <div className="flex items-center gap-6 text-sm">
          <span className="hidden text-[#6b645a] sm:inline">For teams who ship, not triage</span>
          <a href={cta.href} className="font-semibold underline decoration-2 underline-offset-4">
            {cta.label}
          </a>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 pb-16 pt-16 sm:pt-24">
        <p className="mb-6 text-xs font-semibold uppercase tracking-[0.25em] text-[#a14a2a]">The security review, rewritten</p>
        <h1 className="max-w-4xl font-serif text-5xl font-bold leading-[1.02] sm:text-7xl">
          Not a scanner report. <em className="text-[#a14a2a]">A briefing.</em>
        </h1>
        <div className="mt-10 grid gap-10 sm:grid-cols-[1fr_auto]">
          <p className="max-w-2xl text-xl leading-relaxed text-[#4a453e]">
            Connect a repository and receive what a thoughtful security lead would write after a week with your code: what matters, what is risky, and
            what to do next — on the cadence you choose.
          </p>
          <div className="flex flex-col items-start gap-3">
            <a href={cta.href} className="rounded-full bg-[#1d1b18] px-7 py-3.5 font-semibold text-[#f6f3ee] hover:bg-[#a14a2a]">
              {cta.label}
            </a>
            {secondary && (
              <a href={secondary.href} className="text-sm text-[#6b645a] underline underline-offset-4">
                {secondary.label}
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <article className="rounded-sm border border-[#1d1b18]/15 bg-white p-8 shadow-[8px_8px_0_#1d1b18] sm:p-12">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#1d1b18]/10 pb-4">
            <p className="font-serif text-2xl font-bold">Weekly briefing — acme/storefront</p>
            <p className="text-sm text-[#6b645a]">Risk: <strong className="text-[#a14a2a]">High</strong> · 3 actions</p>
          </header>
          <div className="mt-6 grid gap-8 sm:grid-cols-3">
            {[
              ['What matters', 'Admin routes trust a client-side role flag. Any signed-in shopper can reach /admin/refunds.'],
              ['What is risky', 'Two dependencies with known exploits are reachable from checkout; one secret sits in CI logs.'],
              ['What to do next', '1. Enforce role on the server (½ day). 2. Upgrade axios + qs (1 h). 3. Rotate the leaked token (10 min).'],
            ].map(([h, b], i) => (
              <div key={h}>
                <p className="font-serif text-4xl text-[#a14a2a]">{i + 1}</p>
                <p className="mt-2 font-semibold">{h}</p>
                <p className="mt-1 leading-relaxed text-[#4a453e]">{b}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <footer className="border-t border-[#1d1b18]/15 py-8 text-center text-sm text-[#6b645a]">
        Reads your code through a GitHub App · Thinks with your own ChatGPT plan · Stores answers so it never asks twice
      </footer>
    </div>
  )
}
