import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ErrorNote, Lede, Page, Progress, StatusMark, Title, phaseLabel, plural } from '#/components/ui'
import { QuestionCard } from '#/components/QuestionCard'
import { ChatGPTConnect } from '#/components/ChatGPTConnect'
import { PreferencesForm } from '#/components/PreferencesForm'
import { finishOnboarding, getOnboarding, refreshRepos, savePreferences, saveRepoSelection, skipChatGPT, type OnboardingData } from '#/server-fns/app'

export const Route = createFileRoute('/onboarding')({
  validateSearch: (s: Record<string, unknown>): { step?: 'repos' } => (s.step === 'repos' ? { step: 'repos' } : {}),
  loader: () => getOnboarding(),
  head: () => ({ meta: [{ title: 'Set up — openscan' }] }),
  component: Onboarding,
})

const STEPS = [
  { id: 'repos', label: 'Repositories' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'waiting', label: 'Reading' },
] as const

function useAutoRefresh(active: boolean, ms = 3000) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => router.invalidate(), ms)
    return () => clearInterval(t)
  }, [active, ms, router])
}

function Onboarding() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const step = search.step === 'repos' ? 'repos' : data.step === 'done' ? 'waiting' : data.step
  const reading = data.reading.some((r) => r.status === 'queued' || r.status === 'running')
  useAutoRefresh(reading || step === 'waiting')
  const idx = STEPS.findIndex((s) => s.id === step)

  return (
    <Page user={data.user} nav={data.step === 'done'} wide>
      <p className="label">
        Setting up · step {idx + 1} of {STEPS.length}
      </p>
      <ol className="mt-2 flex flex-wrap items-center gap-x-2 font-sans text-[13px]">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2">
            <span className={i === idx ? 'squiggle font-medium text-ink' : i < idx ? 'text-ink-3' : 'text-faint'}>
              {i < idx && '✓ '}
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="text-faint">—</span>}
          </li>
        ))}
      </ol>
      {step === 'repos' && <ReposStep data={data} />}
      {step === 'chatgpt' && <ChatGPTStep data={data} />}
      {step === 'preferences' && <PreferencesStep data={data} />}
      {step === 'waiting' && <WaitingStep data={data} />}
    </Page>
  )
}

/** Main column plus a side column; the side column drops below on narrow screens. */
function Columns({ main, side }: { main: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="grid gap-16 lg:grid-cols-[minmax(0,42rem)_minmax(0,1fr)]">
      <div>{main}</div>
      <aside className="lg:pt-10">{side}</aside>
    </div>
  )
}

// ------------------------------------------------------------------ step 1

function ReposStep({ data }: { data: OnboardingData }) {
  const router = useRouter()
  const [selected, setSelected] = useState<number[]>(data.repos.filter((r) => r.selected).map((r) => r.id))
  const [productName, setProductName] = useState(data.productName ?? data.installations[0]?.account_login ?? 'My product')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <Columns
      main={
        <>
          <Title className="mt-10">Which repositories should we watch?</Title>
          <Lede>The GitHub App can read only what you grant it, and it never writes. Pick the repositories you want reviewed; they become one product with one shared memory.</Lede>

          <label className="mt-10 block">
            <span className="label">Product name</span>
            <input className="field mt-1 font-display text-[28px]" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. Payments platform" />
            <span className="mt-1 block font-sans text-[13px] text-muted">Agents in one product share facts, your answers, and code they have already reviewed.</span>
          </label>

          {data.repos.length === 0 ? (
            <div className="mt-10 border-y border-rule py-8">
              <p className="text-[19px]">No repositories yet.</p>
              <p className="mt-1 text-[17px] text-ink-3">Install the openscan GitHub App on your account or organization and choose which repositories it can read.</p>
              <a href={data.installUrl} className="btn mt-5">
                Install the GitHub App
              </a>
            </div>
          ) : (
            <ul className="mt-10 border-y border-rule">
              {data.repos.map((r) => (
                <li key={r.id} className="border-t border-rule first:border-t-0">
                  <label className="grid cursor-pointer grid-cols-[1.75rem_1fr] items-baseline py-3">
                    <input type="checkbox" className="h-3.5 w-3.5" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                    <span className="min-w-0">
                      <span className="text-[18px]">{r.fullName}</span>
                      <span className="ml-2 font-sans text-[12px] text-muted">
                        {[r.private ? 'private' : null, r.language].filter(Boolean).join(' · ')}
                      </span>
                      {r.description && <span className="block truncate font-sans text-[13px] text-muted">{r.description}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          <button
            className="btn mt-8"
            disabled={!selected.length || busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await saveRepoSelection({ data: { repoIds: selected, productName: productName.trim() || undefined } })
                await router.navigate({ to: data.step === 'done' ? '/dashboard' : '/onboarding', search: {} })
                await router.invalidate()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Saving…' : selected.length ? `Continue with ${plural(selected.length, 'repository', 'repositories')}` : 'Pick at least one'}
          </button>
        </>
      }
      side={
        <div className="font-sans text-[13px] leading-relaxed text-ink-3">
          <p className="label">GitHub access</p>
          <ul className="mt-3 space-y-4">
            {data.installations.map((i) => (
              <li key={i.id}>
                <p className="font-serif text-[17px] text-ink">{i.account_login}</p>
                <p className="text-muted">{i.repository_selection === 'all' ? 'All repositories' : 'Selected repositories'}</p>
                <a href={i.manageUrl} className="link text-ink">
                  Change which repositories ↗
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-6 flex flex-wrap gap-x-4 gap-y-2">
            <a href={data.installUrl} className="link">
              {data.installations.length ? 'Install on another account' : 'Install the GitHub App'}
            </a>
            <button
              className="link"
              onClick={async () => {
                await refreshRepos()
                await router.invalidate()
              }}
            >
              Refresh the list
            </button>
          </p>
          <p className="mt-4 text-muted">After you change access on GitHub, it sends you straight back here.</p>
        </div>
      }
    />
  )
}

// ------------------------------------------------------------------ step 2

function ChatGPTStep({ data }: { data: OnboardingData }) {
  const router = useRouter()
  const n = data.repos.filter((r) => r.selected).length
  return (
    <div className="max-w-[42rem]">
      <Title className="mt-10">Connect your ChatGPT.</Title>
      <Lede>
        openscan thinks with <em>your</em> ChatGPT plan: no API keys, and your session stays on our server, encrypted. The moment you connect, it starts reading{' '}
        {plural(n, 'repository', 'repositories')} while you answer a few questions.
      </Lede>
      <div className="mt-10">
        <ChatGPTConnect />
      </div>
      <p className="mt-6 text-[17px] leading-[1.6] text-ink-3">
        For the deepest reviews, create a{' '}
        <a href={data.codexEnvironmentsUrl} target="_blank" rel="noreferrer" className="link">
          Codex Cloud environment
        </a>{' '}
        for each repository. The agents then run as Codex tasks with the whole repository checked out; without one, they read files through ChatGPT directly.
      </p>
      <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-sans text-[13px] text-muted">
        <button
          className="link"
          onClick={async () => {
            await skipChatGPT()
            await router.invalidate()
          }}
        >
          Skip for now and use the built-in analyzer
        </button>
        <Link to="/onboarding" search={{ step: 'repos' }} className="link">
          ← Change repositories
        </Link>
      </p>
    </div>
  )
}

// ------------------------------------------------------------------ steps 3 and 4

function ReadingPanel({ data, showReading = true }: { data: OnboardingData; showReading?: boolean }) {
  const open = data.questions.filter((q) => q.status === 'open')
  const resolved = data.questions.filter((q) => q.status !== 'open')
  return (
    <div className="space-y-12">
      {showReading && (
      <div>
        <p className="label">The AI is reading</p>
        <ul className="mt-4 space-y-4">
          {data.reading.length === 0 && <li className="text-[16px] italic text-muted">Starting…</li>}
          {data.reading.map((r) => (
            <li key={r.id}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <a href={`/scans/${r.id}`} className="flex min-w-0 items-center gap-2 truncate text-[16px] hover:underline hover:decoration-1 hover:underline-offset-4">
                  <StatusMark status={r.status} />
                  {r.repo}
                </a>
                <span className="font-sans text-[12px] text-muted">{r.status === 'completed' ? 'done' : r.status === 'failed' ? 'failed' : `${r.progress}%`}</span>
              </div>
              <Progress value={r.status === 'completed' ? 100 : r.progress} />
              <p className="mt-1 font-sans text-[11.5px] text-muted">{r.status === 'completed' ? 'Profile ready' : r.status === 'failed' ? 'You can retry from the dashboard' : phaseLabel(r.phase)}{r.engine === 'heuristic' ? ' · built-in analyzer' : ''}</p>
            </li>
          ))}
        </ul>
      </div>
      )}
      <div>
        <p className="label">
          Its questions {open.length > 0 && <span className="text-amber">· {open.length} open</span>}
        </p>
        <p className="mt-2 font-sans text-[13px] leading-snug text-muted">It answers its own questions as it reads further. What it can&rsquo;t settle stays here for you.</p>
        <div className="mt-5 space-y-6">
          {open.map((q) => (
            <QuestionCard key={q.id} q={q} compact />
          ))}
          {resolved.slice(0, 6).map((q) => (
            <QuestionCard key={q.id} q={q} compact />
          ))}
          {data.questions.length === 0 && <p className="text-[16px] italic text-muted">None yet.</p>}
        </div>
      </div>
    </div>
  )
}

function PreferencesStep({ data }: { data: OnboardingData }) {
  const router = useRouter()
  return (
    <Columns
      main={
        <>
          <Title className="mt-10">A few questions while it reads.</Title>
          <Lede>Your answers shape every brief. You can change them later in settings.</Lede>
          <div className="mt-12">
            <PreferencesForm
              initial={data.preferences}
              submitLabel="Save and continue"
              onSubmit={async (p) => {
                await savePreferences({ data: p })
                await router.invalidate()
              }}
            />
          </div>
        </>
      }
      side={<ReadingPanel data={data} />}
    />
  )
}

function WaitingStep({ data }: { data: OnboardingData }) {
  const router = useRouter()
  const allDone = data.reading.length > 0 && data.reading.every((r) => r.status === 'completed' || r.status === 'failed')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    await finishOnboarding()
    await router.navigate({ to: '/dashboard' })
  }
  return (
    <Columns
      main={
        <>
          <Title className="mt-10">{allDone ? 'We know your code now.' : 'Still reading. Hang tight.'}</Title>
          <Lede>
            {allDone
              ? 'Each repository has a profile, and your first security brief is already being written. Answering the open questions makes it sharper.'
              : 'It is mapping your stack, data stores and trust boundaries, and answering its own questions on the way. This usually takes a few minutes.'}
          </Lede>
          <div className="mt-10 space-y-6">
            {data.reading.map((r) => (
              <div key={r.id} className="border-t border-rule pt-4">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-2 text-[19px]">
                    <StatusMark status={r.status} /> {r.repo}
                  </span>
                  <a href={`/scans/${r.id}`} className="font-sans text-[12.5px] text-muted underline underline-offset-4 hover:text-ink">
                    live log
                  </a>
                </div>
                <Progress value={r.status === 'completed' ? 100 : r.progress} />
                <p className="mt-2 font-sans text-[12.5px] text-muted">
                  {r.status === 'completed' ? 'Profile ready' : r.status === 'failed' ? 'Failed. You can retry from the dashboard.' : phaseLabel(r.phase)}
                </p>
              </div>
            ))}
          </div>
          <button className="btn mt-10" onClick={go} disabled={busy}>
            {allDone ? 'Open the brief →' : 'Skip waiting and open the brief'}
          </button>
        </>
      }
      side={<ReadingPanel data={data} showReading={false} />}
    />
  )
}
