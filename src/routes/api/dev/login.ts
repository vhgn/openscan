import { createFileRoute } from '@tanstack/react-router'
import { isDemoLoginEnabled } from '#/lib/env'
import { linkPublicRepo } from '#/lib/github/repos'
import { createSession, sessionCookieHeader } from '#/lib/session'
import { landingPathFor, upsertGithubUser } from '#/lib/users'
import { safeNextPath } from '#/lib/redirect'

/**
 * DEV ONLY (DEV_DEMO_LOGIN=1): signs in a fake GitHub user and links public
 * repositories (read anonymously), so the whole flow can be tried without
 * creating a GitHub App. ?repos=owner/a,owner/b&next=/path
 */
export const Route = createFileRoute('/api/dev/login')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isDemoLoginEnabled()) return new Response('Not found', { status: 404 })
        const url = new URL(request.url)
        const names = (url.searchParams.get('repos') || 'OWASP/NodeGoat,juice-shop/juice-shop')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        const user = await upsertGithubUser({ id: -1, login: 'demo-user', name: 'Demo User', avatar_url: null })
        for (const name of names) {
          const r = await linkPublicRepo(user.id, name).catch((e) => ({ ok: false as const, message: String(e) }))
          if (!r.ok) console.error('demo repo lookup failed', name, r.message)
        }
        const session = await createSession(user.id)
        return new Response(null, {
          status: 302,
          headers: { location: safeNextPath(url.searchParams.get('next')) ?? landingPathFor(user), 'set-cookie': sessionCookieHeader(session, request.url) },
        })
      },
    },
  },
})
