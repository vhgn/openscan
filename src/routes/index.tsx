import { createFileRoute, Link } from '@tanstack/react-router'
import { DEFAULT_DESIGN, LANDING_DESIGNS } from '#/components/landing'
import { getDesign, getMe } from '#/server-fns/app'

export const Route = createFileRoute('/')({
  loader: async () => {
    const [me, design] = await Promise.all([getMe(), getDesign()])
    return { me, design }
  },
  component: Landing,
})

function Landing() {
  const { me, design } = Route.useLoaderData()
  const chosen = LANDING_DESIGNS[design.approved ?? DEFAULT_DESIGN]
  const cta = me.user
    ? { href: me.user.onboardingStep === 'done' ? '/dashboard' : '/onboarding', label: me.user.onboardingStep === 'done' ? 'Open dashboard' : 'Continue setup' }
    : { href: '/api/auth/github/login', label: 'Connect GitHub — it’s free' }
  return (
    <div className="relative">
      {!design.approved && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-stone-800 shadow-lg">
          No landing design approved yet — showing option A (Console).{' '}
          <Link to="/design" className="font-semibold underline">
            Pick one on /design
          </Link>
        </div>
      )}
      <chosen.Component cta={cta} secondary={{ href: '#how', label: 'How it works' }} />
    </div>
  )
}
