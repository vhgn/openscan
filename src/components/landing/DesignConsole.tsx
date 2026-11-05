import type { LandingProps } from './types'

const amber = 'text-[#ffb000]'
const dim = 'text-[#a8770a]'
const faint = 'text-[#6b4c06]'

/** A box with its title set into the top border, the way TUIs draw panes. */
function Pane({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`relative border border-[#ffb000]/60 px-4 pb-4 pt-5 ${className}`}>
      <h2 className="absolute -top-[0.7em] left-3 bg-[#0c0800] px-1.5 text-[12px] tracking-widest">┤ {title} ├</h2>
      {children}
    </section>
  )
}

/** Block-letter wordmark, one glyph per letter (5×5 cells). */
const GLYPHS: Record<string, string[]> = {
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  P: ['████ ', '█   █', '████ ', '█    ', '█    '],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
  S: [' ████', '█    ', ' ███ ', '    █', '████ '],
  C: [' ████', '█    ', '█    ', '█    ', ' ████'],
  A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
}
const LOGO = [0, 1, 2, 3, 4].map((row) => 'OPENSCAN'.split('').map((ch) => GLYPHS[ch][row]).join(' ')).join('\n')

/**
 * Option A — "Console": the landing page *is* a full-screen terminal application
 * (amber phosphor CRT, box-drawn panes, function-key bar).
 */
export function DesignConsole({ cta, secondary }: LandingProps) {
  return (
    <div className={`relative min-h-screen overflow-hidden bg-[#0c0800] font-['IBM_Plex_Mono',ui-monospace,monospace] text-[13px] ${amber} [text-shadow:0_0_6px_rgba(255,176,0,0.35)]`}>
      {/* CRT scanlines + vignette */}
      <div className="pointer-events-none absolute inset-0 z-10 bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.28)_0px,rgba(0,0,0,0.28)_1px,transparent_1px,transparent_3px)]" />
      <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.65))]" />

      {/* menu bar */}
      <header className="flex flex-wrap items-center gap-x-5 gap-y-1 bg-[#ffb000] px-4 py-1 text-[#0c0800] [text-shadow:none]">
        <span className="font-semibold">openscan 2.0</span>
        <span>File</span>
        <span>Scan</span>
        <span>Findings</span>
        <span>Memory</span>
        <span className="ml-auto hidden sm:inline">tty1 · cto@acme · 09:41</span>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <div className="grid items-end gap-6 lg:grid-cols-[auto_1fr]">
          <pre aria-label="openscan" className="overflow-x-auto text-[9px] leading-[1] sm:text-[12px]">{LOGO}</pre>
          <p className={`${dim} lg:pb-2`}>
            continuous AI security review for GitHub · runs on your ChatGPT plan · read-only access
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <Pane title="BRIEF">
            <h1 className="font-['VT323',ui-monospace,monospace] text-[44px] uppercase leading-[0.95] sm:text-[64px]">
              Your scanner found 412 issues.
              <br />
              <span className="bg-[#ffb000] px-1 text-[#0c0800] [text-shadow:none]">openscan shows the 3</span>
              <br />
              that matter.
            </h1>
            <p className={`mt-5 max-w-xl leading-relaxed ${dim}`}>
              It reads your repositories like a red team, hands every finding to a second agent whose only job is to disprove it, and writes a one-page
              brief your leads can plan a sprint from.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <a href={cta.href} className="border border-[#ffb000] bg-[#ffb000] px-4 py-2 text-[#0c0800] [text-shadow:none] hover:bg-transparent hover:text-[#ffb000]">
                [ {cta.label} ]
              </a>
              {secondary && (
                <a href={secondary.href} className={`${dim} underline underline-offset-4 hover:text-[#ffb000]`}>
                  man openscan
                </a>
              )}
              <span className={faint}>
                press <span className="border border-current px-1">↵</span> to connect
              </span>
            </div>
          </Pane>

          <Pane title="FINDINGS · acme/payments-api · sample">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left">
                <thead className={dim}>
                  <tr>
                    <th className="pb-2 font-normal">SEV</th>
                    <th className="pb-2 font-normal">VERDICT</th>
                    <th className="pb-2 font-normal">FINDING</th>
                    <th className="pb-2 text-right font-normal">EFFORT</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-[#ffb000] text-[#0c0800] [text-shadow:none]">
                    <td className="py-0.5 pl-1">HIGH</td>
                    <td>verified</td>
                    <td>webhook signature never checked</td>
                    <td className="pr-1 text-right">4h</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 pl-1">HIGH</td>
                    <td>verified</td>
                    <td>node:20 runtime is end-of-life</td>
                    <td className="pr-1 text-right">1h</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 pl-1">MED</td>
                    <td>needs input</td>
                    <td>admin export reachable?</td>
                    <td className="pr-1 text-right">–</td>
                  </tr>
                  {['sql injection in report filters', 'jwt "none" algorithm accepted', 'path traversal in uploads'].map((t) => (
                    <tr key={t} className={faint}>
                      <td className="py-0.5 pl-1">----</td>
                      <td>rejected</td>
                      <td className="line-through">{t}</td>
                      <td className="pr-1 text-right">–</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`mt-3 ${dim}`}>14 raised · 9 rejected by the validator · 2 waiting on your team</p>
          </Pane>
        </div>

        <Pane title="PIPELINE">
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {[
              ['recon', 10, 'map principals, entry points, trust boundaries'],
              ['hunt', 10, 'AI review + dependency, runtime and CI checks'],
              ['validate', 7, 'a fresh agent tries to refute every finding'],
              ['brief', 3, 'ranked fixes, PoC for each serious issue'],
            ].map(([name, done, note]) => (
              <div key={name as string} className="grid grid-cols-[72px_auto_1fr] items-baseline gap-3">
                <span>{name}</span>
                <span aria-hidden="true">
                  [{'█'.repeat(done as number)}
                  <span className={faint}>{'░'.repeat(10 - (done as number))}</span>]
                </span>
                <span className={`${dim} truncate`}>{note}</span>
              </div>
            ))}
          </div>
        </Pane>
      </main>

      {/* function-key bar */}
      <footer className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-4 text-[12px]">
        {[
          ['F1', 'Help'],
          ['F2', 'Connect'],
          ['F3', 'Pipeline'],
          ['F4', 'Memory'],
          ['F5', 'Rescan'],
          ['F10', 'Quit'],
        ].map(([k, v]) => (
          <span key={k}>
            <span className="bg-[#ffb000] px-1 text-[#0c0800] [text-shadow:none]">{k}</span> {v}
          </span>
        ))}
      </footer>
    </div>
  )
}
