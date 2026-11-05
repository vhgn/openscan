import { useEffect, useRef, useState } from 'react'
import type { Preferences } from '#/lib/types'
import { Squiggle } from './ui'
import { Select } from './Select'

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
            <Squiggle on={value === v} className="text-[18px]">
              {label}
            </Squiggle>
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

export const PREFERENCE_STEPS = 5

/**
 * The preferences questionnaire, shared by onboarding and settings.
 * - Default: every question on one page with one Save button (settings).
 * - `stepped`: one question at a time (onboarding). Single-choice questions move on
 *   by themselves once an option is picked; the last step saves.
 */
export function PreferencesForm({
  initial,
  submitLabel,
  onSubmit,
  stepped,
}: {
  initial: Preferences
  submitLabel: string
  onSubmit: (p: Preferences) => Promise<void>
  stepped?: { index: number; onIndex: (i: number) => void }
}) {
  const [p, setP] = useState<Preferences>(initial)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (advance.current && clearTimeout(advance.current)), [])
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => {
    setSaved(false)
    setP((x) => ({ ...x, [k]: v }))
  }
  const toggleFocus = (f: Preferences['focus'][number]) => set('focus', p.focus.includes(f) ? (p.focus.filter((x) => x !== f) as Preferences['focus']) : [...p.focus, f])
  // In stepped mode, picking a single-choice answer moves on after the squiggle has drawn.
  const choose = <K extends 'frequency' | 'depth'>(k: K, v: Preferences[K]) => {
    set(k, v)
    if (!stepped) return
    if (advance.current) clearTimeout(advance.current)
    const at = stepped.index
    advance.current = setTimeout(() => stepped.onIndex(at + 1), 550)
  }

  const questions: Array<{ title: string; valid: boolean; body: React.ReactNode }> = [
    {
      title: 'How often should a brief arrive?',
      valid: true,
      body: <Choice name="frequency" value={p.frequency} options={FREQ} onChange={(v) => choose('frequency', v)} />,
    },
    {
      title: 'How much research should stand behind it?',
      valid: true,
      body: <Choice name="depth" value={p.depth} options={DEPTH} onChange={(v) => choose('depth', v)} />,
    },
    {
      title: 'What should we look at?',
      valid: p.focus.length > 0,
      body: (
        <>
          <p className="mt-3 text-[18px] leading-[1.9]">
            {FOCUS.map(([f, label], i) => (
              <span key={f}>
                {i > 0 && (i === FOCUS.length - 1 ? ', and ' : ', ')}
                <button
                  type="button"
                  aria-pressed={p.focus.includes(f)}
                  onClick={() => toggleFocus(f)}
                  className={`transition-colors duration-300 ${p.focus.includes(f) ? 'text-ink' : 'text-faint line-through decoration-1 hover:text-muted'}`}
                >
                  <Squiggle on={p.focus.includes(f)}>{label}</Squiggle>
                </button>
              </span>
            ))}
            .
          </p>
          <p className="font-sans text-[13px] text-muted">Tap a word to leave it out.{!p.focus.length && ' Pick at least one.'}</p>
        </>
      ),
    },
    {
      title: 'Who reads the brief, and what can they skip?',
      valid: true,
      body: (
        <p className="mt-3 text-[18px] leading-[2.2]">
          Written for{' '}
          <Select
            className="mx-1"
            label="Audience"
            value={p.audience}
            onChange={(v) => set('audience', v)}
            options={[
              { value: 'developer', label: 'developers' },
              { value: 'security', label: 'the security team' },
              { value: 'executive', label: 'leadership' },
            ]}
          />
          , hiding anything below{' '}
          <Select
            className="mx-1"
            label="Hide findings below"
            value={p.minSeverity}
            onChange={(v) => set('minSeverity', v)}
            options={(['critical', 'high', 'medium', 'low', 'info'] as const).map((v) => ({ value: v, label: v }))}
          />
          .
        </p>
      ),
    },
    {
      title: 'Anything we should know about the product?',
      valid: true,
      body: (
        <>
          <p className="mt-1 pl-7 font-sans text-[13px] text-muted">Internet-facing? Payments or personal data? SOC 2 or HIPAA? Multi-tenant? Every agent reads this. Optional.</p>
          <textarea
            className="field mt-3 min-h-28"
            value={p.context}
            onChange={(e) => set('context', e.target.value)}
            placeholder="e.g. Public B2B SaaS, multi-tenant, customer PII in Postgres, SOC 2 in progress."
          />
        </>
      ),
    },
  ]

  const submit = async () => {
    setBusy(true)
    try {
      await onSubmit(p)
      setSaved(true)
    } finally {
      setBusy(false)
    }
  }

  if (stepped) {
    const i = Math.min(Math.max(stepped.index, 0), questions.length - 1)
    const q = questions[i]
    const last = i === questions.length - 1
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!q.valid) return
          if (last) void submit()
          else stepped.onIndex(i + 1)
        }}
      >
        <p className="label">
          Question {i + 1} of {questions.length}
        </p>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {questions.map((_, k) => (
            <span key={k} className={`h-[2px] flex-1 transition-colors duration-300 ${k <= i ? 'bg-ink' : 'bg-rule'}`} />
          ))}
        </div>
        {/* key: remount per question so it fades in */}
        <div key={i} className="mt-8 animate-[fade-in_0.35s_ease-out]">
          <Question n={i + 1}>{q.title}</Question>
          {q.body}
        </div>
        <div className="mt-10 flex items-center gap-5">
          <button className="btn" disabled={busy || !q.valid}>
            {last ? (busy ? 'Saving…' : submitLabel) : 'Next →'}
          </button>
          {i > 0 && (
            <button type="button" className="font-sans text-[13px] text-muted underline underline-offset-4 hover:text-ink" onClick={() => stepped.onIndex(i - 1)}>
              ← Back
            </button>
          )}
        </div>
      </form>
    )
  }

  return (
    <form
      className="space-y-16"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {questions.map((q, i) => (
        <div key={q.title}>
          <Question n={i + 1}>{q.title}</Question>
          {q.body}
        </div>
      ))}
      <div className="flex items-center gap-4">
        <button className="btn" disabled={busy || !p.focus.length}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {saved && <span className="font-sans text-[13px] text-muted">Saved.</span>}
      </div>
    </form>
  )
}
