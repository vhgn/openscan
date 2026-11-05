import { createFileRoute } from '@tanstack/react-router'
import { Landing } from '#/components/Landing'
import { getMe } from '#/server-fns/app'

export const Route = createFileRoute('/')({
  // The landing page is the only route rendered on the server (see src/start.ts).
  ssr: true,
  loader: () => getMe(),
  component: LandingRoute,
})

function LandingRoute() {
  const me = Route.useLoaderData()
  const cta = me.user
    ? { href: '/home', label: me.user.onboardingStep === 'done' ? 'Open your brief' : 'Continue setup' }
    : { href: '/api/auth/github/login', label: 'Connect GitHub — it’s free' }
  return <Landing cta={cta} />
}
