import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { ErrorNote } from '#/components/ui'
import { answerQuestion, dismissQuestion } from '#/server-fns/app'

export interface QuestionLike {
  id: string
  repo?: string | null
  question: string
  rationale: string | null
  status: string
  answer: string | null
  answer_source: string | null
  evidence: string | null
}

type Outcome = { status: 'answered' | 'dismissed'; answer: string | null; answer_source: 'user' }

/**
 * A question from the AI, set as a line of the brief with a ruled answer line.
 * Answered questions show the answer in italics and who gave it.
 *
 * Answering and skipping are optimistic: the card shows the outcome at once, saves in the
 * background, then refreshes the page data. If saving fails it goes back to the open
 * question with the typed answer restored and an error.
 */
export function QuestionCard({ q, compact = false }: { q: QuestionLike; compact?: boolean }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [optimistic, setOptimistic] = useState<Outcome | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const size = compact ? 'text-[16px]' : 'text-[18px]'
  // Once the server data shows the question settled, it wins over the local guess.
  const shown = optimistic && q.status === 'open' ? { ...q, ...optimistic } : q

  const settle = (outcome: Outcome, save: () => Promise<unknown>, restoreText = '') => {
    setOptimistic(outcome)
    setSaving(true)
    setError(null)
    setText('')
    save()
      .then(() => router.invalidate())
      .catch(() => {
        setOptimistic(null)
        setText(restoreText)
        setError(outcome.status === 'answered' ? 'Your answer was not saved. Try again.' : 'Could not skip this question. Try again.')
      })
      .finally(() => setSaving(false))
  }

  if (shown.status !== 'open') {
    return (
      <div aria-busy={saving}>
        <p className={`${size} leading-[1.35] text-ink-3`}>{shown.question}</p>
        <p className={`mt-1 ${compact ? 'text-[15px]' : 'text-[17px]'} italic text-ink-2`}>
          {shown.status === 'dismissed' ? 'Skipped.' : shown.answer}{' '}
          <span className="font-sans text-[12px] not-italic text-muted">
            ({shown.answer_source === 'ai' ? 'answered by the AI from the code' : shown.status === 'dismissed' ? 'by you' : 'your answer'}
            {saving && ' · saving…'})
          </span>
        </p>
        {shown.evidence && !compact && <p className="mt-1 font-mono text-[12px] text-muted">{shown.evidence}</p>}
      </div>
    )
  }

  return (
    <div>
      {q.repo && !compact && <p className="mb-0.5 font-sans text-[12px] text-muted">{q.repo}</p>}
      <p className={`${size} leading-[1.35]`}>{q.question}</p>
      {q.rationale && <p className="mt-1.5 font-sans text-[13px] leading-snug text-muted">{q.rationale}</p>}
      <form
        className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          const answer = text.trim()
          if (!answer) return
          settle({ status: 'answered', answer, answer_source: 'user' }, () => answerQuestion({ data: { id: q.id, answer } }), answer)
        }}
      >
        <input
          className={`field min-w-[12rem] flex-1 ${compact ? 'text-[15px]' : ''}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          placeholder="Your answer…"
          aria-label="Your answer"
        />
        {/* Save and skip share a row, so skip lines up with the button text. */}
        <span className="flex items-center gap-3">
          <button className="btn btn-sm" disabled={!text.trim()}>
            Save
          </button>
          <button
            type="button"
            className="font-sans text-[12px] text-muted underline underline-offset-4 hover:text-ink"
            onClick={() => settle({ status: 'dismissed', answer: null, answer_source: 'user' }, () => dismissQuestion({ data: { id: q.id } }), text)}
          >
            skip
          </button>
        </span>
      </form>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  )
}

/**
 * A stack of question cards. Each card is kept tight inside; generous space
 * between cards makes it obvious where one question ends.
 */
export function QuestionList({ children, compact = false, className = '' }: { children: ReactNode; compact?: boolean; className?: string }) {
  return <div className={`${compact ? 'space-y-8' : 'space-y-12'} ${className}`}>{children}</div>
}
