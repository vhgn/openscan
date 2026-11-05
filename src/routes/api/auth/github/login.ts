import { createFileRoute } from '@tanstack/react-router'
import { authorizeUrl, githubConfigured } from '#/lib/github/app'
import { randomToken } from '#/lib/crypto'
import { isDemoLoginEnabled } from '#/lib/env'

export const Route = createFileRoute('/api/auth/github/login')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!githubConfigured()) {
          const to = isDemoLoginEnabled() ? '/api/dev/login' : '/?error=github_not_configured'
          return new Response(null, { status: 302, headers: { location: to } })
        }
        const state = randomToken(16)
        const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
        return new Response(null, {
          status: 302,
          headers: {
            location: authorizeUrl(state),
            'set-cookie': `openscan_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
          },
        })
      },
    },
  },
})
