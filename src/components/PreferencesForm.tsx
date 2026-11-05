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
 * The preferences questionnaire, shared by onboarding and settings, as a stepper:
 * one question at a time under a row of numbered steps you can jump between.
 * Single-choice questions move on by themselves once an option is picked.
 * - `stepped`: the step lives with the caller (onboarding keeps it in the URL),
 *   and only the last step saves.
 * - Default (settings): the step is local, and Save is there on every step.
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
  const [localIndex, setLocalIndex] = useState(0)
  const nav = stepped ?? { index: localIndex, onIndex: setLocalIndex }
  const saveAnytime = !stepped
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
    if (advance.current) clearTimeout(advance.current)
    const at = nav.index
    advance.current = setTimeout(() => nav.onIndex(at + 1), 550)
  }

  const questions: Array<{ title: string; step: string; valid: boolean; body: React.ReactNode }> = [
    {
      title: 'How often should a brief arrive?', step: 'Frequency',
      valid: true,
      body: <Choice name="frequency" value={p.frequency} options={FREQ} onChange={(v) => choose('frequency', v)} />,
    },
    {
      title: 'How much research should stand behind it?', step: 'Depth',
      valid: true,
      body: <Choice name="depth" value={p.depth} options={DEPTH} onChange={(v) => choose('depth', v)} />,
    },
    {
      title: 'What should we look at?', step: 'Scope',
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
      title: 'Who reads the brief, and what can they skip?', step: 'Audience',
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
      title: 'Anything we should know about the product?', step: 'Context',
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

  const i = Math.min(Math.max(nav.index, 0), questions.length - 1)
  const q = questions[i]
  const last = i === questions.length - 1
  const allValid = questions.every((x) => x.valid)
  const go = (k: number) => {
    if (advance.current) clearTimeout(advance.current)
    nav.onIndex(k)
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (saveAnytime) {
          if (allValid) void submit()
          return
        }
        if (!q.valid) return
        if (last) void submit()
        else go(i + 1)
      }}
    >
      {/* Stepper: a rule per step that fills as you go, with its number and name beneath. */}
      <ol className="grid gap-x-3" style={{ gridTemplateColumns: `repeat(${questions.length}, minmax(0, 1fr))` }} aria-label="Questions">
        {questions.map((x, k) => {
          const state = k === i ? 'current' : k < i ? 'done' : 'todo'
          return (
            <li key={x.step}>
              <button
                type="button"
                onClick={() => go(k)}
                aria-current={k === i ? 'step' : undefined}
                className={`group block w-full text-left font-sans text-[12.5px] ${state === 'current' ? 'text-ink' : state === 'done' ? 'text-ink-3 hover:text-ink' : 'text-faint hover:text-muted'}`}
              >
                <span className={`block h-[2px] transition-colors duration-300 ${state === 'todo' ? 'bg-rule group-hover:bg-faint' : 'bg-ink'}`} />
                <span className="mt-2 flex items-baseline gap-1.5">
                  <span className="font-display text-[18px] leading-none">{k + 1}</span>
                  <span className="hidden truncate sm:inline">
                    <Squiggle on={k === i}>{x.step}</Squiggle>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      {/* key: remount per question so it fades in */}
      <div key={i} className="mt-10 animate-[fade-in_0.35s_ease-out]">
        <Question n={i + 1}>{q.title}</Question>
        {q.body}
      </div>
      <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
        {saveAnytime ? (
          <>
            <button className="btn" disabled={busy || !allValid}>
              {busy ? 'Saving…' : submitLabel}
            </button>
            {!last && (
              <button type="button" className="btn btn-quiet" disabled={!q.valid} onClick={() => go(i + 1)}>
                Next →
              </button>
            )}
          </>
        ) : (
          <button className="btn" disabled={busy || !q.valid}>
            {last ? (busy ? 'Saving…' : submitLabel) : 'Next →'}
          </button>
        )}
        {i > 0 && (
          <button type="button" className="font-sans text-[13px] text-muted underline underline-offset-4 hover:text-ink" onClick={() => go(i - 1)}>
            ← Back
          </button>
        )}
        {saved && <span className="font-sans text-[13px] text-muted">Saved.</span>}
      </div>
    </form>
  )
}
