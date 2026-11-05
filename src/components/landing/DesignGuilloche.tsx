import { eyeOutline, hatch, iris, rays, rosette } from './guilloche'
import type { LandingProps } from './types'

const ink = '#d7f5e6'
const display = "font-['Big_Shoulders_Display',Impact,sans-serif]"
const engraved = "font-['Cormorant_Garamond',ui-serif,Georgia,serif]"
const micro = "font-['IBM_Plex_Mono',ui-monospace,monospace]"

function Microtext({ text }: { text: string }) {
  return (
    <div aria-hidden="true" className={`overflow-hidden whitespace-nowrap text-[7px] uppercase tracking-[0.25em] text-[#d7f5e6]/45 ${micro}`}>
      {text.repeat(14)}
    </div>
  )
}

/** The engraved Argus eye inside guilloche rings — computed, not drawn by hand. */
function Seal() {
  const c = 300
  return (
    <svg viewBox="0 0 600 600" className="h-auto w-full max-w-[560px]" role="img" aria-label="Engraved eye inside a guilloche rosette">
      <defs>
        <clipPath id="os-eye">
          <path d={eyeOutline(c, c, 150, 62)} />
        </clipPath>
      </defs>
      <g fill="none" stroke={ink} strokeLinecap="round">
        <path d={rays(c, c, 212, 296, 180)} strokeWidth="0.7" opacity="0.55" />
        <path d={rosette(c, c, 210, 30, 52, 1400)} strokeWidth="0.55" opacity="0.8" />
        <path d={rosette(c, c, 175, 25, 40, 1200, 0.12)} strokeWidth="0.5" opacity="0.7" />
        <path d={rosette(c, c, 140, 20, 30, 1000, 0.25)} strokeWidth="0.45" opacity="0.6" />
        <circle cx={c} cy={c} r="214" strokeWidth="1.4" />
        <circle cx={c} cy={c} r="219" strokeWidth="0.6" />
        <path d={eyeOutline(c, c, 150, 62)} fill="#0e4a3a" strokeWidth="1.6" />
        <g clipPath="url(#os-eye)">
          <path d={hatch(140, 170, 460, 430, 4)} strokeWidth="0.6" opacity="0.5" />
          <circle cx={c} cy={c} r="58" fill="#0e4a3a" stroke="none" />
          <path d={iris(c, c, 20, 58, 140)} strokeWidth="0.7" />
          <circle cx={c} cy={c} r="58" strokeWidth="1.4" />
          <circle cx={c} cy={c} r="20" fill={ink} stroke="none" />
          <circle cx={c + 9} cy={c - 9} r="5" fill="#0e4a3a" stroke="none" />
        </g>
        <path d={eyeOutline(c, c, 158, 66)} strokeWidth="0.6" opacity="0.7" />
      </g>
    </svg>
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
            <nav className={`mt-3 flex items-center justify-between gap-4 text-[12px] uppercase tracking-[0.3em] ${micro}`}>
              <span className="text-[#d7f5e6]/70">Nº OS-0457</span>
              <span className={`${display} text-[30px] font-light normal-case tracking-[0.06em]`}>openscan</span>
              <a href={cta.href} className="border border-[#d7f5e6]/60 px-3 py-1.5 hover:bg-[#d7f5e6] hover:text-[#0e4a3a]">
                Connect
              </a>
            </nav>

            <section className="mt-10 grid items-center gap-10 lg:grid-cols-[1fr_1fr]">
              <div>
                <p className={`${engraved} text-[20px] italic text-[#d7f5e6]/80`}>Argus Panoptes, the watchman who never slept</p>
                <h1 className={`${display} mt-3 text-[76px] font-[200] uppercase leading-[0.86] tracking-[0.01em] sm:text-[112px]`}>
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
                <div className={`mt-8 flex flex-wrap items-center gap-3 text-[12px] uppercase tracking-[0.25em] ${micro}`}>
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
                  <p className={`${engraved} text-[40px] italic leading-none`}>{n}</p>
                  <p className={`${display} mt-2 text-[28px] font-light uppercase tracking-[0.12em]`}>{t}</p>
                  <p className="mt-2 text-[14px] text-[#d7f5e6]/75">{d}</p>
                </div>
              ))}
            </section>

            <div className={`mt-10 flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-[0.3em] text-[#d7f5e6]/60 ${micro}`}>
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
