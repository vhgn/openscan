import { createFileRoute } from '@tanstack/react-router'
import { userFromRequest } from '#/lib/session'
import { syncUserRepos } from '#/lib/github/repos'

/**
 * GitHub App "Setup URL": GitHub redirects here after the app is installed or
 * its repository selection is updated. We resync and return to onboarding.
 */
export const Route = createFileRoute('/api/github/setup')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await userFromRequest(request)
        if (!user) return new Response(null, { status: 302, headers: { location: '/api/auth/github/login' } })
        await syncUserRepos(user).catch((e) => console.error('repo sync failed', e))
        const to = user.onboarding_step === 'done' ? '/dashboard?repos=updated' : '/onboarding?installed=1'
        return new Response(null, { status: 302, headers: { location: to } })
      },
    },
  },
})
