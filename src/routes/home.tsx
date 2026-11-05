import { createFileRoute } from '@tanstack/react-router'
import { Brief } from '#/components/Brief'
import { PREFERENCE_STEPS } from '#/components/PreferencesForm'
import { Setup } from '#/components/Setup'
import { getHome } from '#/server-fns/app'

export interface HomeSearch {
  /** Reopen the repository picker after setup is done. */
  step?: 'repos'
  /** Preferences sub-step during setup (1-based question number). */
  q?: number
}

/** Home for signed-in users: the setup steps until onboarding is done, then the brief. */
export const Route = createFileRoute('/home')({
  validateSearch: (s: Record<string, unknown>): HomeSearch => ({
    ...(s.step === 'repos' ? { step: 'repos' as const } : {}),
    ...(Number(s.q) >= 1 && Number(s.q) <= PREFERENCE_STEPS ? { q: Number(s.q) } : {}),
  }),
  loaderDeps: ({ search }) => ({ setup: search.step === 'repos' }),
  loader: ({ deps }) => getHome({ data: { setup: deps.setup } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.kind === 'brief' ? 'Brief — openscan' : 'Set up — openscan' }] }),
  component: Home,
})

function Home() {
  const home = Route.useLoaderData()
  return home.kind === 'brief' ? <Brief data={home.data} /> : <Setup data={home.data} />
}
