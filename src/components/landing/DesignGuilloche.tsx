import { rosette } from './guilloche'
import type { LandingProps } from './types'

const ink = '#d7f5e6'
// Large type is serif, small type is sans.
const serif = "font-['Cormorant_Garamond',ui-serif,Georgia,serif]"
const sans = "font-['Inter',ui-sans-serif,system-ui,sans-serif]"

function Microtext({ text }: { text: string }) {
  return (
    <div aria-hidden="true" className={`overflow-hidden whitespace-nowrap text-[7px] uppercase tracking-[0.25em] text-[#d7f5e6]/45 ${sans}`}>
      {text.repeat(14)}
    </div>
  )
}

/**
 * Marble head of Apollo (ca. 27 BCE–68 CE, The Metropolitan Museum of Art, CC0),
 * ordered-dithered into 1-bit dots with a 1 px gap by scripts/dither_image.py.
 */
function Seal() {
  return (
    <figure className="w-[540px] max-w-full">
      <img
        src="/landing/apollo-dither.png"
        width={540}
        height={540}
        alt="Dithered photograph of a marble head of Apollo with scanning interface frames"
        className="h-auto w-full [image-rendering:pixelated]"
      />
      <figcaption className={`mt-2 text-right text-[10px] uppercase tracking-[0.2em] text-[#d7f5e6]/55 ${sans}`}>
        Marble head of Apollo, ca. 27 BCE–68 CE · The Met, CC0
      </figcaption>
    </figure>
  )
}

/**
 * Option C — "Guilloche": banknote security printing (the craft built to stop forgery)
 * as the visual language for a security product. Argus Panoptes, the hundred-eyed
 * watchman who never slept, is the emblem.
 */
export function DesignGuilloche({ cta, secondary }: LandingProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0e4a3a] text-[#d7f5e6]">
      <div className="pointer-events-none absolute -right-40 top-10 opacity-[0.07]">
        <svg viewBox="0 0 600 600" width="900" height="900" aria-hidden="true">
          <path d={rosette(300, 300, 280, 40, 70, 1600)} fill="none" stroke={ink} strokeWidth="0.6" />
        </svg>
      </div>

      <div className="relative mx-auto max-w-6xl px-6 py-6">
        {/* engraved frame */}
        <div className="border border-[#d7f5e6]/50 p-1.5">
          <div className="border border-[#d7f5e6]/25 px-5 pb-10 pt-3 sm:px-10">
            <Microtext text="openscan · continuous security review · every finding challenged · " />
            <nav className={`mt-3 flex items-center justify-between gap-4 text-[12px] uppercase tracking-[0.3em] ${sans}`}>
              <span className="text-[#d7f5e6]/70">Nº OS-0457</span>
              <span className={`${serif} text-[30px] font-medium normal-case tracking-[0.04em]`}>openscan</span>
              <a href={cta.href} className="border border-[#d7f5e6]/60 px-3 py-1.5 hover:bg-[#d7f5e6] hover:text-[#0e4a3a]">
                Connect
              </a>
            </nav>

            <section className="mt-10 grid items-center gap-10 lg:grid-cols-[1fr_1fr]">
              <div>
                <p className={`${sans} text-[12px] uppercase tracking-[0.3em] text-[#d7f5e6]/70`}>Continuous security review · like Argus, it never sleeps</p>
                <h1 className={`${serif} mt-4 text-[52px] font-[300] uppercase leading-[0.95] tracking-[0.01em] sm:text-[72px]`}>
                  A hundred
                  <br />
                  eyes on
                  <br />
                  your code.
                </h1>
                <p className="mt-7 max-w-md text-[17px] leading-relaxed text-[#d7f5e6]/80">
                  openscan watches every repository in your product. Each finding is challenged by a second agent before it reaches you, so the brief on
                  your desk holds only what survived.
                </p>
                <div className={`mt-8 flex flex-wrap items-center gap-3 text-[12px] uppercase tracking-[0.25em] ${sans}`}>
                  <a href={cta.href} className="bg-[#d7f5e6] px-5 py-3 text-[#0e4a3a] hover:bg-white">
                    {cta.label}
                  </a>
                  {secondary && (
                    <a href={secondary.href} className="border border-[#d7f5e6]/50 px-5 py-3 hover:bg-[#d7f5e6]/10">
                      {secondary.label}
                    </a>
                  )}
                </div>
              </div>
              <div className="flex justify-center">
                <Seal />
              </div>
            </section>

            <section id="how" className="mt-14 grid gap-4 sm:grid-cols-3">
              {[
                ['I', 'Recon', 'Maps who can reach what before judging anything.'],
                ['II', 'Challenge', 'A fresh agent tries to refute every finding.'],
                ['III', 'Brief', 'What survived, ranked, with a fix and a proof.'],
              ].map(([n, t, d]) => (
                <div key={t} className="border border-[#d7f5e6]/35 p-5 text-center [background:radial-gradient(circle_at_center,rgba(215,245,230,0.06),transparent_70%)]">
                  <p className={`${serif} text-[40px] italic leading-none`}>{n}</p>
                  <p className={`${serif} mt-2 text-[28px] font-medium uppercase tracking-[0.1em]`}>{t}</p>
                  <p className="mt-2 text-[14px] text-[#d7f5e6]/75">{d}</p>
                </div>
              ))}
            </section>

            <div className={`mt-10 flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-[0.3em] text-[#d7f5e6]/60 ${sans}`}>
              <span>Series 2026 · read-only GitHub App</span>
              <span>Runs on your ChatGPT plan</span>
            </div>
            <div className="mt-2">
              <Microtext text="verified · needs input · rejected · " />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
