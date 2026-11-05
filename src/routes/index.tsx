import { createFileRoute } from '@tanstack/react-router'
import { DesignEssay } from '#/components/landing/DesignEssay'
import { getMe } from '#/server-fns/app'

export const Route = createFileRoute('/')({
  // The landing page is the only route rendered on the server (see src/start.ts).
  ssr: true,
  loader: () => getMe(),
  component: Landing,
})

function Landing() {
  const me = Route.useLoaderData()
  const cta = me.user
    ? { href: '/home', label: me.user.onboardingStep === 'done' ? 'Open your brief' : 'Continue setup' }
    : { href: '/api/auth/github/login', label: 'Connect GitHub — it’s free' }
  return <DesignEssay cta={cta} secondary={{ href: '/design?view=report', label: 'See a sample brief' }} />
}
