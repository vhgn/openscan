import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Lede, Margin, Page, SectionHead, Title, plural } from '#/components/ui'
import { ChatGPTConnect } from '#/components/ChatGPTConnect'
import { PreferencesForm } from '#/components/PreferencesForm'
import {
  checkCodexInternet,
  disconnectChatGPT,
  getOnboarding,
  listCodexEnvironments,
  refreshCodexEnvironments,
  saveCodexRunner,
  savePreferences,
  testCodexInternet,
} from '#/server-fns/app'

export const Route = createFileRoute('/settings')({
  loader: async () => {
    const data = await getOnboarding()
    if (data.step !== 'done') throw redirect({ to: '/home' })
    return data
  },
  head: () => ({ meta: [{ title: 'Settings — openscan' }] }),
  component: Settings,
})

function Settings() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const selected = data.repos.filter((r) => r.selected)
  const checking = selected.some((r) => r.codexNet === 'checking')
  const blocked = data.codexBlockedAt !== null

  // An internet check is a Codex task (1–3 min): poll until every check settles.
  useEffect(() => {
    if (!checking) return
    const t = setInterval(async () => {
      const res = await checkCodexInternet().catch(() => ({}) as Record<number, string>)
      if (Object.values(res).some((v) => v !== 'checking')) await router.invalidate()
    }, 10_000)
    return () => clearInterval(t)
  }, [checking, router])

  return (
    <Page user={data.user}>
      <p className="label">Settings</p>
      <Title>How openscan works for you.</Title>
      <Lede>What it reads, whose ChatGPT it thinks with, and what the brief looks like.</Lede>

      <SectionHead aside={<Link to="/home" search={{ step: 'repos' }} className="link">Change</Link>}>Repositories</SectionHead>
      <p className="mt-4 text-[18px] leading-[1.6]">
        Watching {plural(selected.length, 'repository', 'repositories')}
        {data.productName ? (
          <>
            {' '}
            in <span className="italic">{data.productName}</span>
          </>
        ) : null}
        : {selected.map((r) => r.fullName).join(', ') || 'none yet'}.
      </p>

      <SectionHead>ChatGPT</SectionHead>
      {data.user.chatgpt ? (
        <div className="relative mt-4">
          <p className="text-[18px] leading-[1.6]">
            Connected{data.user.chatgpt.email ? <> as <span className="italic">{data.user.chatgpt.email}</span></> : null}
            {data.user.chatgpt.plan ? <> on the {data.user.chatgpt.plan} plan</> : null}. Every review runs on this account.
          </p>
          <button
            className="mt-3 font-sans text-[13px] text-muted underline underline-offset-4 hover:text-ink"
            disabled={busy !== null}
            onClick={async () => {
              if (!confirm('Disconnect ChatGPT? Reviews fall back to the built-in analyzer until you connect again.')) return
              setBusy('chatgpt')
              await disconnectChatGPT()
              await router.invalidate()
              setBusy(null)
            }}
          >
            Disconnect
          </button>
          <Margin>The session is stored encrypted on our server and only used to run your reviews.</Margin>
        </div>
      ) : (
        <div className="mt-4">
          <p className="mb-5 text-[18px] leading-[1.6] text-ink-3">Not connected: reviews use the built-in pattern analyzer. Connect ChatGPT for a real review.</p>
          <ChatGPTConnect />
        </div>
      )}

      {data.user.chatgpt && (
        <>
          <SectionHead
            aside={
              <a href={data.codexEnvironmentsUrl} target="_blank" rel="noreferrer" className="link">
                Manage environments ↗
              </a>
            }
          >
            Codex Cloud
          </SectionHead>
          <p className="mt-4 text-[17px] leading-[1.6] text-ink-3">
            With a Codex environment, agents work as Codex tasks with the whole repository checked out. Without one, they use the runner environment below if you pick one, or read files through ChatGPT.
          </p>
          {blocked && (
            <p className="mt-4 border-l-2 border-rule pl-4 text-[17px] leading-[1.6]" role="status">
              chatgpt.com is blocking openscan&rsquo;s server from Codex Cloud: its bot protection answers with a 403 page before the request reaches the Codex API (last seen{' '}
              {new Date(data.codexBlockedAt!).toLocaleString()}). Until that changes, scans use direct ChatGPT review on your plan. &ldquo;Check again&rdquo; retries.
            </p>
          )}
          <ul className="mt-4 border-y border-rule">
            {selected.map((r) => (
              <li key={r.id} className="border-t border-rule py-2.5 first:border-t-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="min-w-0 break-words text-[17px]">{r.fullName}</span>
                  <span className={`font-sans text-[12.5px] ${r.codexEnv ? 'text-ink' : 'text-muted'}`}>
                    {blocked
                      ? '○ Codex unreachable'
                      : r.codexEnv
                        ? `● ${r.codexEnv}`
                        : data.codexRunner
                          ? `◐ runner: ${data.codexRunner.label ?? data.codexRunner.id}`
                          : r.codexChecked
                            ? '○ no environment'
                            : '○ not checked yet'}
                  </span>
                </div>
                {r.codexEnv && !blocked && (
                  <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-sans text-[12.5px] text-muted">
                    <span className={r.codexNet === 'reachable' ? 'text-ink' : undefined}>
                      {r.codexNet === 'reachable'
                        ? `Internet: reaches ${data.openscanHost}, so Codex can read full product memory`
                        : r.codexNet === 'unreachable'
                          ? `Internet: can't reach ${data.openscanHost}. Turn on agent internet access for this environment, allowlist ${data.openscanHost}, and allow GET. Until then Codex uses the inline memory summary.`
                          : r.codexNet === 'checking'
                            ? 'Internet: checking with a short Codex task (1–3 min)…'
                            : 'Internet: not checked yet'}
                    </span>
                    {r.codexNet !== 'checking' && (
                      <button
                        className="underline underline-offset-4 hover:text-ink"
                        disabled={busy !== null}
                        onClick={async () => {
                          setBusy(`net:${r.id}`)
                          setNote(null)
                          const res = await testCodexInternet({ data: { repoId: r.id } })
                          if (!res.ok) setNote(res.reason)
                          await router.invalidate()
                          setBusy(null)
                        }}
                      >
                        {busy === `net:${r.id}` ? 'Starting…' : r.codexNet ? 'Test again' : 'Test internet'}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-center gap-4 font-sans text-[13px] text-muted">
            <button
              className="underline underline-offset-4 hover:text-ink"
              disabled={busy !== null}
              onClick={async () => {
                setBusy('codex')
                setNote(null)
                const res = await refreshCodexEnvironments()
                setNote(res.ok ? `Found ${res.found} of ${res.total}.` : res.reason)
                await router.invalidate()
                setBusy(null)
              }}
            >
              {busy === 'codex' ? 'Checking…' : 'Check again'}
            </button>
            {note && <span>{note}</span>}
          </p>
          {!blocked && <RunnerPicker runner={data.codexRunner} />}
        </>
      )}

      <SectionHead>The brief</SectionHead>
      <div className="mt-6">
        <PreferencesForm
          initial={data.preferences}
          submitLabel="Save preferences"
          onSubmit={async (p) => {
            await savePreferences({ data: p })
            await router.invalidate()
          }}
        />
      </div>
    </Page>
  )
}

type Runner = { id: string; label: string | null; branch: string } | null

/** One Codex environment for every repo without its own: its tasks clone the repo under review first. */
function RunnerPicker({ runner }: { runner: Runner }) {
  const router = useRouter()
  const [envs, setEnvs] = useState<Array<{ id: string; label: string | null }> | null>(null)
  const [envId, setEnvId] = useState(runner?.id ?? '')
  const [branch, setBranch] = useState(runner?.branch ?? 'main')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function load() {
    setBusy(true)
    setNote(null)
    const res = await listCodexEnvironments()
    if (res.ok) {
      setEnvs(res.envs)
      if (!envId && res.envs[0]) setEnvId(res.envs[0].id)
      if (!res.envs.length) setNote('No environments in your Codex workspace yet.')
    } else setNote(res.reason)
    setBusy(false)
  }

  async function save(id: string | null) {
    setBusy(true)
    setNote(null)
    const res = await saveCodexRunner({ data: { envId: id, branch } })
    if (res.ok) {
      setEnvs(null)
      await router.invalidate()
    } else setNote(res.reason)
    setBusy(false)
  }

  return (
    <div className="mt-8">
      <p className="label">Runner environment</p>
      <p className="mt-2 text-[17px] leading-[1.6] text-ink-3">
        Repositories without their own environment can run in one shared environment instead. Each task clones the repository first (private ones with a read-only token
        for that repository, revoked when the task ends), so the runner needs agent internet access with <span className="font-mono text-[14px]">github.com</span> allowlisted.
        Setup scripts don&rsquo;t run for the cloned repository, so agents review its code but can&rsquo;t run its tests.
      </p>
      {runner && !envs && (
        <p className="mt-3 font-sans text-[13px]">
          ● {runner.label ?? runner.id} <span className="text-muted">(checks out {runner.branch})</span>
        </p>
      )}
      {envs && envs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 font-sans text-[13px]">
          <select className="border border-rule bg-transparent px-2 py-1" value={envId} onChange={(e) => setEnvId(e.target.value)} aria-label="Runner environment">
            {envs.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label ?? e.id}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-muted">
            branch of its repo
            <input className="w-28 border border-rule bg-transparent px-2 py-1 text-ink" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Runner branch" />
          </label>
          <button className="underline underline-offset-4 hover:text-ink" disabled={busy || !envId} onClick={() => save(envId)}>
            {busy ? 'Saving…' : 'Use this environment'}
          </button>
          <button className="text-muted underline underline-offset-4 hover:text-ink" disabled={busy} onClick={() => setEnvs(null)}>
            Cancel
          </button>
        </div>
      )}
      {!envs && (
        <p className="mt-3 flex items-center gap-4 font-sans text-[13px] text-muted">
          <button className="underline underline-offset-4 hover:text-ink" disabled={busy} onClick={load}>
            {busy ? 'Loading…' : runner ? 'Change' : 'Choose an environment'}
          </button>
          {runner && (
            <button className="underline underline-offset-4 hover:text-ink" disabled={busy} onClick={() => save(null)}>
              Stop using it
            </button>
          )}
          {note && <span>{note}</span>}
        </p>
      )}
      {envs && note && <p className="mt-2 font-sans text-[13px] text-muted">{note}</p>}
    </div>
  )
}
