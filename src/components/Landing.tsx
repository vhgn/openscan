export interface LandingProps {
  cta: { href: string; label: string }
}

const serif = "font-['Newsreader',ui-serif,Georgia,serif]"
const display = "font-['Instrument_Serif',ui-serif,Georgia,serif]"

function Mark({ children }: { children: React.ReactNode }) {
  // Cream squiggle underline (wavy text-decoration) instead of a highlighter fill.
  return <mark className="bg-transparent text-inherit underline decoration-[#e3c98b] decoration-wavy decoration-2 underline-offset-[6px] [text-decoration-skip-ink:none]">{children}</mark>
}

function Note({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <aside className="text-[13px] leading-snug text-[#6f6f6a] lg:absolute lg:left-[calc(100%+2.5rem)] lg:top-1 lg:w-56">
      <sup className="mr-1 text-[#141414]">{n}</sup>
      {children}
    </aside>
  )
}

/**
 * The public landing page: a short argument addressed to engineering leaders,
 * set like a well-made long read (one column, margin notes, cream squiggle).
 */
export function Landing({ cta }: LandingProps) {
  return (
    <div className={`relative min-h-screen bg-[#fbfbf9] text-[#141414] ${serif}`}>
      <nav className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-6 py-6 text-[15px]">
        <span className={`${display} text-2xl`}>openscan</span>
        <a href={cta.href} className="underline decoration-1 underline-offset-4 hover:decoration-2">
          {cta.label}
        </a>
      </nav>

      <article className="mx-auto max-w-5xl px-6 pb-24 pt-10 sm:pt-16">
        <div className="max-w-[40rem]">
          <p className="text-[13px] uppercase tracking-[0.2em] text-[#6f6f6a]">On security reviews</p>
          <h1 className={`${display} mt-4 text-[52px] leading-[1.02] tracking-[-0.01em] sm:text-[76px]`} style={{ textWrap: 'balance' }}>
            You don&rsquo;t need another scanner. You need <em>a second opinion.</em>
          </h1>

          <div className="mt-12 space-y-6 text-[19px] leading-[1.65] sm:text-[20px]">
            <p className="first-letter:float-left first-letter:mr-2 first-letter:font-['Instrument_Serif'] first-letter:text-[4.6em] first-letter:leading-[0.8]">
              Every engineering leader has opened the report. Four hundred rows, sorted by a score nobody on the team trusts, half of them about code that
              never sees user input. The team skims it, fixes the two that look scary, and the rest becomes background noise until an auditor asks about it.
            </p>

            <h2 className="mb-3 pt-10 text-[13px] uppercase tracking-[0.2em] text-[#6f6f6a]">What changes</h2>
            <div className="relative">
              <p>
                openscan reads your repositories the way an attacker would, then does something scanners never do:{' '}
                <Mark>it hands every finding to a second, independent agent whose only job is to prove it wrong.</Mark>
                <sup>1</sup> If the input never reaches the sink, or a control upstream already stops it, the finding is rejected, and you can read why.
              </p>
              <Note n={1}>The validator follows published methods from Trail of Bits and Cloudflare: reachability, real impact, no upstream control.</Note>
            </div>
            <div className="relative">
              <p>
                What survives gets a severity it has earned, the exact path from entry point to sink, and the smallest fix that closes it. When the answer
                depends on something only your team knows, such as whether the admin panel is public, <Mark>it asks once and remembers.</Mark>
                <sup>2</sup>
              </p>
              <Note n={2}>Answers are shared across every repository in a product, so the same question is never asked twice.</Note>
            </div>

            <blockquote className={`${display} border-l-2 border-[#141414] py-1 pl-6 text-[30px] leading-[1.2] sm:text-[36px]`}>
              The goal is not more findings. It is fewer, truer ones, with a reason attached.
            </blockquote>

            <h2 className="mb-3 pt-10 text-[13px] uppercase tracking-[0.2em] text-[#6f6f6a]">What lands on your desk</h2>
            <p>Each week, or on every push if you prefer, a one-page brief that reads like this:</p>
            <ol className="list-none space-y-4 border-y border-[#141414]/15 py-6 text-[18px]">
              {[
                ['Fix now', 'Forged Stripe webhooks can mark invoices as paid.', 'Verify the signature on the raw body before any state change. About half a day.'],
                ['This sprint', 'The Node 20 runtime is end-of-life.', 'Move to 22.23.4, keeping the alpine image. About an hour.'],
                ['Your call', 'Is the admin export reachable from the internet?', 'One answer decides whether this is high or nothing.'],
              ].map(([when, what, how]) => (
                <li key={what} className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-6">
                  <span className="text-[13px] uppercase tracking-[0.18em] text-[#6f6f6a] sm:pt-1">{when}</span>
                  <span>
                    <span className="font-medium">{what}</span> <span className="text-[#4a4a46]">{how}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="relative">
              <p>
                It runs on your own ChatGPT plan, reads code through a read-only GitHub App, and never opens a pull request or touches production.
                <sup>3</sup>
              </p>
              <Note n={3}>When you have a Codex Cloud environment, the agents work inside it with the full repository checked out.</Note>
            </div>
          </div>

          <div className="mt-14">
            <a href={cta.href} className="inline-block bg-[#141414] px-6 py-3 font-['Inter',ui-sans-serif,system-ui,sans-serif] text-[15px] font-semibold text-[#fbfbf9] hover:bg-[#333]">
              {cta.label}
            </a>
          </div>
          <p className="mt-6 text-[15px] italic text-[#6f6f6a]">— the openscan team</p>
        </div>
      </article>
    </div>
  )
}
