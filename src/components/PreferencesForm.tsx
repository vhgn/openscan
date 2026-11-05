import { useState } from 'react'
import type { Preferences } from '#/lib/types'

const FREQ: Array<[Preferences['frequency'], string, string]> = [
  ['on_push', 'On every push', 'Each push to the default branch gets a review of what changed.'],
  ['daily', 'Every morning', 'One brief a day.'],
  ['weekly', 'Every Monday', 'A weekly brief, the default for most teams.'],
  ['monthly', 'Once a month', 'A monthly posture review.'],
  ['manual', 'Only when I ask', 'No automatic reviews.'],
]
const DEPTH: Array<[Preferences['depth'], string, string]> = [
  ['triage', 'A quick triage', 'Fast pass over the riskiest code. Top issues only.'],
  ['standard', 'A standard review', 'Ranked findings with impact and the smallest fix.'],
  ['deep_poc', 'Deep research, with proof', 'Every serious finding comes with a proof of concept and steps to verify the fix.'],
]
const FOCUS: Array<[Preferences['focus'][number], string]> = [
  ['code', 'application code'],
  ['dependencies', 'dependencies'],
  ['secrets', 'secrets'],
  ['config', 'configuration'],
  ['ci', 'CI/CD'],
]

/** A question with its options as a ruled list of radio lines. */
function Choice<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: Array<[T, string, string]>; onChange: (v: T) => void }) {
  return (
    <div className="mt-3 border-y border-rule" role="radiogroup">
      {options.map(([v, label, hint]) => (
        <label key={v} className="grid cursor-pointer grid-cols-[1.75rem_1fr] items-baseline border-t border-rule py-3 first:border-t-0">
          <input type="radio" name={name} className="h-3.5 w-3.5 translate-y-[1px]" checked={value === v} onChange={() => onChange(v)} />
          <span>
            <span className={`text-[18px] ${value === v ? 'squiggle' : ''}`}>{label}</span>
            <span className="block font-sans text-[13px] text-muted">{hint}</span>
          </span>
        </label>
      ))}
    </div>
  )
}

function Question({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <p className="grid grid-cols-[1.75rem_1fr] text-[20px] leading-[1.4]">
      <span className="font-display text-[24px] leading-none">{n}.</span>
      <span>{children}</span>
    </p>
  )
}

/** The preferences questionnaire, shared by onboarding and settings. */
export function PreferencesForm({ initial, submitLabel, onSubmit }: { initial: Preferences; submitLabel: string; onSubmit: (p: Preferences) => Promise<void> }) {
  const [p, setP] = useState<Preferences>(initial)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => {
    setSaved(false)
    setP((x) => ({ ...x, [k]: v }))
  }
  const toggleFocus = (f: Preferences['focus'][number]) => set('focus', p.focus.includes(f) ? (p.focus.filter((x) => x !== f) as Preferences['focus']) : [...p.focus, f])

  return (
    <form
      className="space-y-12"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await onSubmit(p)
          setSaved(true)
        } finally {
          setBusy(false)
        }
      }}
    >
      <div>
        <Question n={1}>How often should a brief arrive?</Question>
        <Choice name="frequency" value={p.frequency} options={FREQ} onChange={(v) => set('frequency', v)} />
      </div>
      <div>
        <Question n={2}>How much research should stand behind it?</Question>
        <Choice name="depth" value={p.depth} options={DEPTH} onChange={(v) => set('depth', v)} />
      </div>
      <div>
        <Question n={3}>What should we look at?</Question>
        <p className="mt-3 text-[18px] leading-[1.9]">
          {FOCUS.map(([f, label], i) => (
            <span key={f}>
              {i > 0 && (i === FOCUS.length - 1 ? ', and ' : ', ')}
              <button
                type="button"
                aria-pressed={p.focus.includes(f)}
                onClick={() => toggleFocus(f)}
                className={p.focus.includes(f) ? 'squiggle' : 'text-faint line-through decoration-1 hover:text-muted'}
              >
                {label}
              </button>
            </span>
          ))}
          .
        </p>
        <p className="font-sans text-[13px] text-muted">Tap a word to leave it out.{!p.focus.length && ' Pick at least one.'}</p>
      </div>
      <div>
        <Question n={4}>Who reads the brief, and what can they skip?</Question>
        <p className="mt-3 text-[18px] leading-[2.2]">
          Written for{' '}
          <select className="field mx-1 inline-block w-auto" value={p.audience} onChange={(e) => set('audience', e.target.value as Preferences['audience'])} aria-label="Audience">
            <option value="developer">developers</option>
            <option value="security">the security team</option>
            <option value="executive">leadership</option>
          </select>
          , hiding anything below{' '}
          <select className="field mx-1 inline-block w-auto" value={p.minSeverity} onChange={(e) => set('minSeverity', e.target.value as Preferences['minSeverity'])} aria-label="Minimum severity">
            {['critical', 'high', 'medium', 'low', 'info'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          .
        </p>
      </div>
      <div>
        <Question n={5}>Anything we should know about the product?</Question>
        <p className="mt-1 pl-7 font-sans text-[13px] text-muted">Internet-facing? Payments or personal data? SOC 2 or HIPAA? Multi-tenant? Every agent reads this.</p>
        <textarea
          className="field mt-3 min-h-28"
          value={p.context}
          onChange={(e) => set('context', e.target.value)}
          placeholder="e.g. Public B2B SaaS, multi-tenant, customer PII in Postgres, SOC 2 in progress."
        />
      </div>
      <div className="flex items-center gap-4">
        <button className="btn" disabled={busy || !p.focus.length}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {saved && <span className="font-sans text-[13px] text-muted">Saved.</span>}
      </div>
    </form>
  )
}
