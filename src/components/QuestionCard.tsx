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

export function QuestionCard({ q, compact = false }: { q: QuestionLike; compact?: boolean }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  if (q.status !== 'open') {
    return (
      <div className={`rounded-lg border hairline ${compact ? 'p-2.5' : 'p-3'} text-sm`}>
        <p className="muted line-through decoration-1">{q.question}</p>
        <p className="mt-1">
          <span className={`mr-1 rounded px-1 text-[10px] font-bold uppercase ${q.answer_source === 'ai' ? 'bg-emerald-600 text-white' : 'bg-[var(--fg)] text-[var(--bg)]'}`}>
            {q.answer_source === 'ai' ? 'AI answered' : 'You'}
          </span>
          {q.answer}
        </p>
        {q.evidence && !compact && <p className="muted mt-1 font-mono text-xs">{q.evidence}</p>}
      </div>
    )
  }
  return (
    <div className={`rounded-lg border border-amber-500/40 bg-amber-500/5 ${compact ? 'p-2.5' : 'p-3'} text-sm`}>
      {q.repo && !compact && <p className="muted text-xs">{q.repo}</p>}
      <p className="font-medium">{q.question}</p>
      {q.rationale && <p className="muted mt-0.5 text-xs">{q.rationale}</p>}
      <form
        className="mt-2 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!text.trim()) return
          setBusy(true)
          await answerQuestion({ data: { id: q.id, answer: text.trim() } })
          setBusy(false)
          await router.invalidate()
        }}
      >
        <input className="input py-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer" />
        <button className="btn btn-primary py-1" disabled={busy || !text.trim()}>
          Save
        </button>
        <button
          type="button"
          className="muted px-1 text-xs underline"
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
