import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
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

/**
 * A question from the AI, set as a line of the brief with a ruled answer line.
 * Answered questions show the answer in italics and who gave it.
 */
export function QuestionCard({ q, compact = false }: { q: QuestionLike; compact?: boolean }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const size = compact ? 'text-[16px]' : 'text-[19px]'

  if (q.status !== 'open') {
    return (
      <div>
        <p className={`${size} leading-[1.5] text-ink-3`}>{q.question}</p>
        <p className={`mt-1 ${compact ? 'text-[15px]' : 'text-[17px]'} italic text-ink-2`}>
          {q.status === 'dismissed' ? 'Skipped.' : q.answer}{' '}
          <span className="font-sans text-[12px] not-italic text-muted">
            ({q.answer_source === 'ai' ? 'answered by the AI from the code' : q.status === 'dismissed' ? 'by you' : 'your answer'})
          </span>
        </p>
        {q.evidence && !compact && <p className="mt-1 font-mono text-[12px] text-muted">{q.evidence}</p>}
      </div>
    )
  }

  return (
    <div>
      {q.repo && !compact && <p className="font-sans text-[12px] text-muted">{q.repo}</p>}
      <p className={`${size} leading-[1.5]`}>{q.question}</p>
      {q.rationale && <p className="mt-1 font-sans text-[13px] leading-snug text-muted">{q.rationale}</p>}
      <form
        className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!text.trim()) return
          setBusy(true)
          try {
            await answerQuestion({ data: { id: q.id, answer: text.trim() } })
            await router.invalidate()
          } finally {
            setBusy(false)
          }
        }}
      >
        <input className={`field min-w-[12rem] flex-1 ${compact ? 'text-[15px]' : ''}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer…" aria-label="Your answer" />
        <button className="btn btn-sm" disabled={busy || !text.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="font-sans text-[12px] text-muted underline underline-offset-4 hover:text-ink"
          onClick={async () => {
            await dismissQuestion({ data: { id: q.id } })
            await router.invalidate()
          }}
        >
          skip
        </button>
      </form>
    </div>
  )
}
