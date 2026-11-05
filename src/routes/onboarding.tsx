import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { LoginWithChatGPT } from '@opencoredev/loginwithchatgpt-react'
import { useEffect, useState } from 'react'
import { Progress, StatusDot, TopBar } from '#/components/ui'
import { QuestionCard } from '#/components/QuestionCard'
import {
  finishOnboarding,
  getOnboarding,
  linkChatGPTSession,
  refreshRepos,
  savePreferences,
  saveRepoSelection,
  skipChatGPT,
  type OnboardingData,
} from '#/server-fns/app'
import type { Preferences } from '#/lib/types'

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
    <div className="min-h-screen">
      <TopBar user={data.user} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <ol className="mb-10 flex flex-wrap items-center gap-2 text-sm">
          {STEPS.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  i < idx ? 'bg-emerald-600 text-white' : i === idx ? 'bg-[var(--fg)] text-[var(--bg)]' : 'border hairline muted'
                }`}
              >
                {i < idx ? '✓' : i + 1}
              </span>
              <span className={i === idx ? 'font-semibold' : 'muted'}>{s.label}</span>
              {i < STEPS.length - 1 && <span className="muted mx-1">—</span>}
            </li>
          ))}
        </ol>
        {step === 'repos' && <ReposStep data={data} />}
        {step === 'chatgpt' && <ChatGPTStep data={data} />}
        {step === 'preferences' && <PreferencesStep data={data} />}
        {step === 'waiting' && <WaitingStep data={data} />}
      </main>
    </div>
  )
}

// ------------------------------------------------------------------ step 1

function ReposStep({ data }: { data: OnboardingData }) {
  const router = useRouter()
  const [selected, setSelected] = useState<number[]>(data.repos.filter((r) => r.selected).map((r) => r.id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <section className="grid gap-8 md:grid-cols-[1fr_280px]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Which repositories should we watch?</h1>
        <p className="muted mt-1">The GitHub App only sees repositories you grant it. Pick the ones you want reviewed.</p>

        {data.repos.length === 0 ? (
          <div className="app-card mt-6 p-8 text-center">
            <p className="font-semibold">No repositories yet</p>
            <p className="muted mt-1 text-sm">Install the openscan GitHub App on your account or organization and choose repositories.</p>
            <a href={data.installUrl} className="btn btn-primary mt-5">
              Install GitHub App
            </a>
          </div>
        ) : (
          <ul className="app-card mt-6 divide-y divide-[var(--line)]">
            {data.repos.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{r.fullName}</span>
                    {r.private && <span className="muted ml-2 rounded border hairline px-1 text-[11px]">private</span>}
                    {r.language && <span className="muted ml-2 text-xs">{r.language}</span>}
                    {r.description && <span className="muted block truncate text-sm">{r.description}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex items-center gap-3">
          <button
            className="btn btn-primary"
            disabled={!selected.length || busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await saveRepoSelection({ data: { repoIds: selected } })
                await router.navigate({ to: '/onboarding', search: {} })
                await router.invalidate()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Saving…' : `Continue with ${selected.length || ''} repo${selected.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>

      <aside className="space-y-3 text-sm">
        <p className="font-semibold">GitHub access</p>
        {data.installations.map((i) => (
          <div key={i.id} className="app-card p-3">
            <p className="font-medium">{i.account_login}</p>
            <p className="muted text-xs">{i.repository_selection === 'all' ? 'All repositories' : 'Selected repositories'}</p>
            <a href={i.manageUrl} className="mt-2 inline-block text-xs font-semibold underline">
              Update repository selection ↗
            </a>
          </div>
        ))}
        <a href={data.installUrl} className="btn btn-ghost w-full justify-center">
          {data.installations.length ? 'Install on another account' : 'Install GitHub App'}
        </a>
        <button
          className="btn btn-ghost w-full justify-center"
          onClick={async () => {
            await refreshRepos()
            await router.invalidate()
          }}
        >
          Refresh list
        </button>
        <p className="muted text-xs">After changing access on GitHub you're sent back here automatically.</p>
      </aside>
    </section>
  )
}

// ------------------------------------------------------------------ step 2

function ChatGPTStep({ data }: { data: OnboardingData }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight">Connect ChatGPT for inference</h1>
      <p className="muted mt-1">
        openscan thinks with <em>your</em> ChatGPT plan — no API keys, and your tokens stay server-side in an encrypted session. Once connected, the AI
        immediately starts reading {data.repos.filter((r) => r.selected).length} repositor{data.repos.filter((r) => r.selected).length === 1 ? 'y' : 'ies'}{' '}
        while you answer a few questions.
      </p>
      <div className="app-card mt-6 p-6">
        {mounted ? (
          <LoginWithChatGPT
            consent={{ appName: 'openscan' }}
            onAuthenticated={async () => {
              const res = await linkChatGPTSession()
              if (!res.linked) setError(`ChatGPT session not ready (${res.status}). Try again.`)
              await router.invalidate()
            }}
          />
        ) : (
          <div className="h-10" />
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
      <p className="muted mt-4 text-sm">
        For the deepest scans, create a{' '}
        <a href={data.codexEnvironmentsUrl} target="_blank" rel="noreferrer" className="underline">
          Codex Cloud environment
        </a>{' '}
        for each repository: openscan then runs its agents as Codex Cloud tasks with the full repo checked out. Without one, it reviews files through ChatGPT directly.
      </p>
      <button
        className="muted mt-4 text-sm underline"
        onClick={async () => {
          await skipChatGPT()
          await router.invalidate()
        }}
      >
        Skip for now — use the built-in heuristic analyzer
      </button>
      <p className="mt-6 text-sm">
        <Link to="/onboarding" search={{ step: 'repos' }} className="muted underline">
          ← Change repositories
        </Link>
      </p>
    </section>
  )
}

// ------------------------------------------------------------------ step 3

const FREQ: Array<[Preferences['frequency'], string, string]> = [
  ['on_push', 'On every push', 'Review each push to the default branch'],
  ['daily', 'Daily', 'One report a day'],
  ['weekly', 'Weekly', 'A Monday-morning briefing'],
  ['monthly', 'Monthly', 'A monthly posture review'],
  ['manual', 'Only when I ask', 'No automatic scans'],
]
const DEPTH: Array<[Preferences['depth'], string, string]> = [
  ['triage', 'Quick triage', 'Fast pass, top risks only'],
  ['standard', 'Standard review', 'Ranked findings with impact and fixes'],
  ['deep_poc', 'Deep research + PoC', 'Every serious finding backed by a proof-of-concept and verification steps'],
]

function Choice<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string, string]>; onChange: (v: T) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map(([v, label, hint]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-lg border p-3 text-left text-sm transition ${value === v ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : 'hairline hover:border-[var(--muted)]'}`}
        >
          <span className="font-semibold">{label}</span>
          <span className="muted block text-xs">{hint}</span>
        </button>
      ))}
    </div>
  )
}

function ReadingPanel({ data }: { data: OnboardingData }) {
  const open = data.questions.filter((q) => q.status === 'open')
  const resolved = data.questions.filter((q) => q.status !== 'open')
  return (
    <aside className="space-y-4">
      <div className="app-card p-4">
        <p className="text-sm font-semibold">AI is reading your code</p>
        <ul className="mt-3 space-y-3">
          {data.reading.length === 0 && <li className="muted text-sm">Starting…</li>}
          {data.reading.map((r) => (
            <li key={r.id} className="text-sm">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 truncate">
                  <StatusDot status={r.status} />
                  {r.repo}
                </span>
                <span className="muted text-xs">{r.status === 'completed' ? 'done' : `${r.progress}%`}</span>
              </div>
              <Progress value={r.progress} />
              {r.engine === 'heuristic' && <p className="muted mt-1 text-[11px]">heuristic mode</p>}
            </li>
          ))}
        </ul>
      </div>
      <div className="app-card p-4">
        <p className="text-sm font-semibold">
          Questions from the AI {open.length > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[11px] text-white">{open.length}</span>}
        </p>
        <p className="muted text-xs">It answers its own questions as it reads further. Only what it can't figure out stays open.</p>
        <div className="mt-3 space-y-2">
          {open.map((q) => (
            <QuestionCard key={q.id} q={q} compact />
          ))}
          {resolved.slice(0, 6).map((q) => (
            <QuestionCard key={q.id} q={q} compact />
          ))}
          {data.questions.length === 0 && <p className="muted text-xs">No questions yet.</p>}
        </div>
      </div>
    </aside>
  )
}

function PreferencesStep({ data }: { data: OnboardingData }) {
  const router = useRouter()
  const [p, setP] = useState<Preferences>(data.preferences)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setP((x) => ({ ...x, [k]: v }))
  const toggleFocus = (f: Preferences['focus'][number]) =>
    set('focus', p.focus.includes(f) ? (p.focus.filter((x) => x !== f) as Preferences['focus']) : [...p.focus, f])

  return (
    <section className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">A few questions while the AI reads</h1>
          <p className="muted mt-1">Your answers shape every report. You can change them later.</p>
        </div>
        <div>
          <p className="mb-2 font-semibold">How often do you want security reports?</p>
          <Choice value={p.frequency} options={FREQ} onChange={(v) => set('frequency', v)} />
        </div>
        <div>
          <p className="mb-2 font-semibold">How much research should back each report?</p>
          <Choice value={p.depth} options={DEPTH} onChange={(v) => set('depth', v)} />
        </div>
        <div>
          <p className="mb-2 font-semibold">What should we look at?</p>
          <div className="flex flex-wrap gap-2">
            {(['code', 'dependencies', 'secrets', 'config', 'ci'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => toggleFocus(f)}
                className={`rounded-full border px-3 py-1 text-sm ${p.focus.includes(f) ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]' : 'hairline'}`}
              >
                {f === 'ci' ? 'CI/CD' : f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block font-semibold">Hide findings below</span>
            <select className="input" value={p.minSeverity} onChange={(e) => set('minSeverity', e.target.value as Preferences['minSeverity'])}>
              {['critical', 'high', 'medium', 'low', 'info'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block font-semibold">Who reads the reports?</span>
            <select className="input" value={p.audience} onChange={(e) => set('audience', e.target.value as Preferences['audience'])}>
              <option value="developer">Developers</option>
              <option value="security">Security team</option>
              <option value="executive">Leadership</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block font-semibold">Anything we should know about the product?</span>
          <span className="muted mb-2 block text-sm">Internet-facing? Handles payments or PII? Compliance needs (SOC 2, HIPAA)? Multi-tenant?</span>
          <textarea className="input min-h-24" value={p.context} onChange={(e) => set('context', e.target.value)} placeholder="e.g. Public B2B SaaS, multi-tenant, stores customer PII in Postgres, SOC 2 in progress." />
        </label>
        <button
          className="btn btn-primary"
          disabled={busy || !p.focus.length}
          onClick={async () => {
            setBusy(true)
            try {
              await savePreferences({ data: p })
              await router.invalidate()
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
      <ReadingPanel data={data} />
    </section>
  )
}

// ------------------------------------------------------------------ step 4

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
    <section className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{allDone ? 'Your repositories are understood' : 'Hang tight — the AI is still reading'}</h1>
        <p className="muted mt-1">
          {allDone
            ? 'We built a profile of each repository and queued your first security report. Answer any open questions to sharpen it.'
            : 'It is mapping your stack, data stores and trust boundaries, and answering its own questions along the way. This usually takes a few minutes.'}
        </p>
        {data.reading.map((r) => (
          <div key={r.id} className="app-card mt-4 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 font-medium">
                <StatusDot status={r.status} /> {r.repo}
              </span>
              <a href={`/scans/${r.id}`} className="muted text-xs underline">
                live log
              </a>
            </div>
            <Progress value={r.progress} />
            <p className="muted mt-2 text-xs">{r.status === 'completed' ? 'Profile ready' : r.status === 'failed' ? 'Failed — you can retry from the dashboard' : `Phase: ${r.phase}`}</p>
          </div>
        ))}
        <button className="btn btn-primary mt-6" onClick={go} disabled={busy}>
          {allDone ? 'Go to dashboard →' : 'Skip waiting, open dashboard'}
        </button>
      </div>
      <ReadingPanel data={data} />
    </section>
  )
}
