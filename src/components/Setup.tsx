import { Link, useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ErrorNote, Lede, Page, Progress, Squiggle, StatusMark, Title, phaseLabel, plural } from '#/components/ui'
import { QuestionCard } from '#/components/QuestionCard'
import { ChatGPTConnect } from '#/components/ChatGPTConnect'
import { PREFERENCE_STEPS, PreferencesForm } from '#/components/PreferencesForm'
import { finishOnboarding, getInstallTargets, refreshRepos, savePreferences, saveRepoSelection, skipChatGPT, type OnboardingData } from '#/server-fns/app'
import type { InstallTarget } from '#/lib/github/repos'


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

/**
 * The setup steps, shown on /home until onboarding is done (and for
 * /home?step=repos afterwards). Search params: step=repos, q=<preferences question>.
 */
export function Setup({ data }: { data: OnboardingData }) {
  const search = useSearch({ from: '/home' })
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
            <span className={i === idx ? 'font-medium text-ink' : i < idx ? 'text-ink-3' : 'text-faint'}>
              {i < idx && '✓ '}
              <Squiggle on={i === idx}>{s.label}</Squiggle>
              {i === idx && s.id === 'preferences' && (
                <span className="ml-1.5 font-normal text-muted">
                  {search.q ?? 1}/{PREFERENCE_STEPS}
                </span>
              )}
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

function useInstallTargets() {
  const [targets, setTargets] = useState<InstallTarget[] | null>(null)
  useEffect(() => {
    let live = true
    getInstallTargets()
      .then((t) => live && setTargets(t))
      .catch(() => live && setTargets([]))
    return () => {
      live = false
    }
  }, [])
  return targets
}

/** Personal account and organizations, each with a one-click install (or a link to change repositories). */
function AccountList({ data, targets, compact = false }: { data: OnboardingData; targets: InstallTarget[] | null; compact?: boolean }) {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  return (
    <div>
      <ul className={compact ? 'space-y-4' : 'border-y border-rule'}>
        {targets === null && <li className="py-3 text-[16px] italic text-muted">Looking up your organizations…</li>}
        {targets?.map((t) => (
          <li key={t.login} className={compact ? '' : 'grid grid-cols-[2.5rem_1fr_auto] items-center gap-x-3 border-t border-rule py-3 first:border-t-0'}>
            {!compact &&
              (t.avatarUrl ? (
                <img src={t.avatarUrl} alt="" className={`h-8 w-8 grayscale ${t.type === 'Organization' ? 'rounded-md' : 'rounded-full'}`} />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-wash font-sans text-[11px] font-semibold uppercase text-muted">{t.login.slice(0, 2)}</span>
              ))}
            <span className="min-w-0">
              <span className={`block truncate ${compact ? 'font-serif text-[17px] text-ink' : 'text-[19px]'}`}>{t.login}</span>
              <span className="block font-sans text-[12.5px] text-muted">
                {t.type === 'Organization' ? 'Organization' : 'Personal account'}
                {t.installationId ? ' · connected' : ''}
              </span>
            </span>
            {t.installationId ? (
              <a href={t.manageUrl ?? data.installUrl} className={`font-sans text-[13px] ${compact ? 'link text-ink' : 'link'}`}>
                Change repositories ↗
              </a>
            ) : (
              <a href={t.installUrl} className={compact ? 'link font-sans text-[13px] text-ink' : 'btn btn-sm'}>
                {compact ? 'Install ↗' : 'Install'}
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 font-sans text-[13px] text-muted">
        <a href={data.installUrl} className="link">
          Another organization ↗
        </a>
        <button
          className="link"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true)
            try {
              await refreshRepos()
              await router.invalidate()
            } finally {
              setRefreshing(false)
            }
          }}
        >
          {refreshing ? 'Refreshing…' : 'I’ve installed it, refresh'}
        </button>
      </p>
    </div>
  )
}

function ReposStep({ data }: { data: OnboardingData }) {
  const targets = useInstallTargets()
  return data.repos.length === 0 ? <ConnectGitHub data={data} targets={targets} /> : <PickRepos data={data} targets={targets} />
}

/** First visit: nothing connected yet. Ask for the GitHub App install, suggesting each account and organization. */
function ConnectGitHub({ data, targets }: { data: OnboardingData; targets: InstallTarget[] | null }) {
  return (
    <div className="max-w-[42rem]">
      <Title className="mt-10">Connect your code.</Title>
      <Lede>
        openscan reads code through a GitHub App with read-only access, and it never writes. Install it on your account or an organization, choose the repositories it may read, and GitHub
        sends you straight back here.
      </Lede>
      <p className="label mt-10">Where is your code?</p>
      <div className="mt-3">
        <AccountList data={data} targets={targets} />
      </div>
      <p className="mt-6 text-[16px] italic leading-[1.6] text-muted">
        Not an owner of the organization? GitHub sends the install request to its owners, and the repositories appear here once one of them approves.
      </p>
    </div>
  )
}

/** Repositories are connected: pick which to review. Continue sits in a bar that stays in view. */
function PickRepos({ data, targets }: { data: OnboardingData; targets: InstallTarget[] | null }) {
  const router = useRouter()
  const [selected, setSelected] = useState<number[]>(data.repos.filter((r) => r.selected).map((r) => r.id))
  const [productName, setProductName] = useState(data.productName ?? data.installations[0]?.account_login ?? 'My product')
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const q = filter.trim().toLowerCase()
  const shown = data.repos.filter((r) => !q || r.fullName.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q))
  const owners = [...new Set(shown.map((r) => r.fullName.split('/')[0]))]

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await saveRepoSelection({ data: { repoIds: selected, productName: productName.trim() || undefined } })
      await router.navigate({ to: '/home', search: {} })
      await router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Columns
      main={
        <>
          <Title className="mt-10">Which repositories should we watch?</Title>
          <Lede>
            Pick the ones you want reviewed. Together they become one product,{' '}
            <input
              className="field inline-block w-[12rem] py-0 align-baseline text-[19px] italic"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              aria-label="Product name"
              placeholder="name it"
            />
            , with one shared memory.
          </Lede>

          {/* Sticky action bar: filter on the left, count and Continue on the right. */}
          <div className="sticky top-0 z-10 -mx-2 mt-8 flex flex-wrap items-end gap-x-4 gap-y-2 bg-paper/95 px-2 py-3 backdrop-blur">
            <input className="field min-w-[10rem] flex-1 font-sans text-[14px]" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter repositories…" aria-label="Filter repositories" />
            <span className="pb-1.5 font-sans text-[13px] text-muted">{selected.length} selected</span>
            <button className="btn" disabled={!selected.length || busy} onClick={save}>
              {busy ? 'Saving…' : 'Continue →'}
            </button>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}

          {owners.map((owner) => {
            const repos = shown.filter((r) => r.fullName.startsWith(`${owner}/`))
            const allOn = repos.every((r) => selected.includes(r.id))
            return (
              <section key={owner} className="mt-6">
                <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-2">
                  <h2 className="label">{owner}</h2>
                  <button
                    className="font-sans text-[12.5px] text-muted underline underline-offset-4 hover:text-ink"
                    onClick={() => setSelected((s) => (allOn ? s.filter((id) => !repos.some((r) => r.id === id)) : [...new Set([...s, ...repos.map((r) => r.id)])]))}
                  >
                    {allOn ? 'Clear' : `Select all ${repos.length}`}
                  </button>
                </div>
                <ul>
                  {repos.map((r) => (
                    <li key={r.id} className="border-b border-rule">
                      <label className="grid cursor-pointer grid-cols-[1.75rem_1fr] items-baseline py-3">
                        <input type="checkbox" className="h-3.5 w-3.5" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                        <span className="min-w-0">
                          <span className="text-[18px]">{r.fullName.slice(owner.length + 1)}</span>
                          <span className="ml-2 font-sans text-[12px] text-muted">{[r.private ? 'private' : null, r.language].filter(Boolean).join(' · ')}</span>
                          {r.description && <span className="block truncate font-sans text-[13px] text-muted">{r.description}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
          {shown.length === 0 && <p className="mt-6 text-[17px] italic text-muted">No repository matches &ldquo;{filter}&rdquo;.</p>}
        </>
      }
      side={
        <div className="font-sans text-[13px] leading-relaxed text-ink-3">
          <p className="label">GitHub access</p>
          <div className="mt-4">
            <AccountList data={data} targets={targets} compact />
          </div>
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
        <Link to="/home" search={{ step: 'repos' }} className="link">
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
  const { q } = useSearch({ from: '/home' })
  const navigate = useNavigate({ from: '/home' })
  return (
    <Columns
      main={
        <>
          <Title className="mt-10">A few questions while it reads.</Title>
          <Lede>Five quick questions. Your answers shape every brief, and you can change them later in settings.</Lede>
          <div className="mt-10">
            <PreferencesForm
              initial={data.preferences}
              submitLabel="Save and continue"
              stepped={{ index: (q ?? 1) - 1, onIndex: (i) => navigate({ search: (prev) => ({ ...prev, q: i + 1 }) }) }}
              onSubmit={async (p) => {
                await savePreferences({ data: p })
                await navigate({ search: {} })
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
    await router.navigate({ to: '/home', search: {} })
    await router.invalidate()
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
