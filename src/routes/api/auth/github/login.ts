import { createFileRoute } from '@tanstack/react-router'
import { authorizeUrl, githubConfigured } from '#/lib/github/app'
import { randomToken } from '#/lib/crypto'
import { isDemoLoginEnabled } from '#/lib/env'
import { safeNextPath } from '#/lib/redirect'

export const Route = createFileRoute('/api/auth/github/login')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // ?next=/path: where to land after signing in.
        const next = safeNextPath(new URL(request.url).searchParams.get('next'))
        if (!githubConfigured()) {
          const to = isDemoLoginEnabled() ? `/api/dev/login${next ? `?next=${encodeURIComponent(next)}` : ''}` : '/?error=github_not_configured'
          return new Response(null, { status: 302, headers: { location: to } })
        }
        const state = randomToken(16)
        const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
        const headers = new Headers({ location: authorizeUrl(state) })
        headers.append('set-cookie', `openscan_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`)
        headers.append('set-cookie', next ? `openscan_next=${encodeURIComponent(next)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}` : 'openscan_next=; Path=/; Max-Age=0')
        return new Response(null, { status: 302, headers })
      },
    },
  },
})
