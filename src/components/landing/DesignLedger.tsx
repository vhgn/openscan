import type { LandingProps } from './types'

function Stamp({ kind }: { kind: 'verified' | 'input' | 'rejected' }) {
  const s =
    kind === 'verified'
      ? 'border-[#1f6f43] text-[#1f6f43]'
      : kind === 'input'
        ? 'border-[#b7791f] text-[#b7791f]'
        : 'border-[#8a8379] text-[#8a8379] line-through'
  const label = kind === 'verified' ? 'Verified' : kind === 'input' ? 'Needs input' : 'Rejected'
  return <span className={`inline-block -rotate-2 whitespace-nowrap rounded-sm border-2 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest ${s}`}>{label}</span>
}

function Redacted({ w }: { w: string }) {
  return <span className={`inline-block h-[0.9em] translate-y-[2px] bg-[#1d1b18] ${w}`} />
}

/**
 * Option B — "Ledger": light, editorial. The product is the security briefing a
 * consultancy would hand a CTO: a risk register with verdicts, not a scanner dump.
 */
export function DesignLedger({ cta, secondary }: LandingProps) {
  return (
    <div className="relative min-h-screen bg-[#f4f1ea] text-[#1d1b18]">
      <nav className="mx-auto flex max-w-6xl items-center justify-between border-b border-[#1d1b18]/15 px-6 py-5">
        <span className="font-serif text-xl font-bold">openscan</span>
        <div className="flex items-center gap-6 text-sm">
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.2em] text-[#6b645a] md:inline">Security briefings for engineering leadership</span>
          <a href={cta.href} className="font-semibold underline decoration-2 underline-offset-4">
            {cta.label}
          </a>
        </div>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-14 pt-14 lg:grid-cols-[1.15fr_1fr] lg:pt-20">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-[#8c2f1b]">Confidential · prepared for the CTO</p>
          <h1 className="mt-5 font-serif text-5xl font-bold leading-[1.02] sm:text-6xl lg:text-7xl">
            A security brief your board would <em className="text-[#8c2f1b]">actually read.</em>
          </h1>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-[#4a453e]">
            openscan reviews your repositories like an outside security firm: an attacker&apos;s read of the code, an independent second opinion on every
            finding, then a short briefing that ranks the risk, names the owner and puts a cost on the fix.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <a href={cta.href} className="rounded-full bg-[#1d1b18] px-7 py-3.5 font-semibold text-[#f4f1ea] hover:bg-[#8c2f1b]">
              {cta.label}
            </a>
            {secondary && (
              <a href={secondary.href} className="text-sm text-[#6b645a] underline underline-offset-4">
                {secondary.label}
              </a>
            )}
          </div>
          <ul className="mt-10 grid max-w-xl gap-3 border-t border-[#1d1b18]/15 pt-6 text-sm text-[#4a453e] sm:grid-cols-3">
            <li>
              <span className="block font-serif text-2xl text-[#1d1b18]">Second opinion</span>
              on every finding before it reaches you
            </li>
            <li>
              <span className="block font-serif text-2xl text-[#1d1b18]">Proof</span>
              a reproducible PoC for each serious issue
            </li>
            <li>
              <span className="block font-serif text-2xl text-[#1d1b18]">Cadence</span>
              weekly, monthly or on every push
            </li>
          </ul>
        </div>

        {/* The briefing */}
        <article className="relative self-start rounded-sm border border-[#1d1b18]/20 bg-white p-7 shadow-[10px_10px_0_#1d1b18]">
          <div className="absolute -right-3 -top-3 rotate-3 rounded-sm bg-[#8c2f1b] px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-white">TLP:AMBER</div>
          <header className="border-b border-[#1d1b18]/10 pb-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#6b645a]">Security posture brief · week 45 · sample</p>
            <p className="mt-1 font-serif text-2xl font-bold">acme/payments-api</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <span>
                Risk <strong className="text-[#8c2f1b]">High</strong>
              </span>
              <span className="text-[#6b645a]">14 raised → 3 verified</span>
              <span className="text-[#6b645a]">≈ 1 engineer-day to clear</span>
            </div>
          </header>
          <table className="mt-4 w-full text-left text-[13px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-widest text-[#6b645a]">
                <th className="pb-2 font-normal">#</th>
                <th className="pb-2 font-normal">Finding</th>
                <th className="pb-2 font-normal">Verdict</th>
                <th className="pb-2 text-right font-normal">Effort</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {(
                [
                  ['01', 'Forged webhooks can mark invoices paid', 'handlers/stripe.ts:18', 'verified', '½ day'],
                  ['02', 'Node 20 runtime is end-of-life (CVE-2026-111497)', 'Dockerfile:1', 'verified', '1 h'],
                  ['03', 'Admin export reachable without role check?', 'Only if the admin panel is internet-facing', 'input', '—'],
                  ['04', 'SQL injection in report filters', 'Value is bound by the ORM upstream', 'rejected', '—'],
                ] as const
              ).map(([n, t, sub, verdict, effort]) => (
                <tr key={n} className="border-t border-[#1d1b18]/10">
                  <td className="py-2.5 pr-2 font-serif text-lg text-[#8c2f1b]">{n}</td>
                  <td className="py-2.5 pr-3">
                    <span className={verdict === 'rejected' ? 'text-[#8a8379] line-through' : 'font-medium'}>{t}</span>
                    <span className="block font-mono text-[11px] text-[#6b645a]">{sub}</span>
                  </td>
                  <td className="py-2.5 pr-2">
                    <Stamp kind={verdict} />
                  </td>
                  <td className="py-2.5 text-right font-mono text-[12px] text-[#6b645a]">{effort}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 border-t border-[#1d1b18]/10 pt-3 text-[13px] leading-relaxed text-[#4a453e]">
            <p>
              <span className="font-semibold text-[#1d1b18]">Recommendation.</span> Verify Stripe signatures on the raw body before any state change, then
              upgrade the runtime to 22.23.4. Exposure detail on <Redacted w="w-24" /> withheld pending owner confirmation.
            </p>
          </div>
        </article>
      </section>

      <section id="how" className="border-t border-[#1d1b18]/15">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-3">
          {[
            ['I.', 'Reconnaissance', 'The repository is mapped before it is judged: who can do what, where input enters, which controls exist and which are assumed.'],
            ['II.', 'Adversarial review', 'Findings are hunted, then challenged by an independent reviewer. Unproven claims are rejected or turned into a question for your team.'],
            ['III.', 'The briefing', 'What matters, what is risky and what to do next, in plain language, ranked by business impact, with a PoC where it counts.'],
          ].map(([n, t, d]) => (
            <div key={t}>
              <p className="font-serif text-4xl italic text-[#8c2f1b]">{n}</p>
              <p className="mt-2 font-serif text-xl font-bold">{t}</p>
              <p className="mt-2 leading-relaxed text-[#4a453e]">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-[#1d1b18]/15 py-8 text-center text-sm text-[#6b645a]">
        Read-only GitHub App · Runs on your own ChatGPT plan · Methodology built on open-source security skills from Trail of Bits, Cloudflare, Anthropic,
        NVIDIA, Cognition and OpenAI
      </footer>
    </div>
  )
}
