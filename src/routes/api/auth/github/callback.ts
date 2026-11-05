import { createFileRoute } from '@tanstack/react-router'
import { exchangeCode, gh, storeUserToken } from '#/lib/github/app'
import { syncUserRepos } from '#/lib/github/repos'
import { createSession, sessionCookieHeader } from '#/lib/session'
import { landingPathFor, upsertGithubUser } from '#/lib/users'
import { first } from '#/lib/db'
import type { UserRow } from '#/lib/types'
import { safeNextPath } from '#/lib/oauth/core'

function cookie(request: Request, name: string) {
  return (request.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1]
}

export const Route = createFileRoute('/api/auth/github/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        // Our own login always carries `state` (CSRF check). The only stateless case we accept is GitHub's
        // "request user authorization during installation" redirect, which also carries installation_id.
        const installRedirect = !state && url.searchParams.has('installation_id')
        if (!code || (!installRedirect && (!state || state !== cookie(request, 'openscan_oauth_state')))) {
          return new Response('Invalid OAuth state. Please try signing in again.', { status: 400 })
        }
        const token = await exchangeCode(code)
        const profile = await gh<{ id: number; login: string; name: string | null; avatar_url: string | null }>('/user', token.accessToken)
        const user = await upsertGithubUser(profile)
        await storeUserToken(user.id, token)
        const fresh = (await first<UserRow>('SELECT * FROM users WHERE id = ?', user.id))!
        await syncUserRepos(fresh).catch((e) => console.error('repo sync failed', e))
        const session = await createSession(user.id)
        // Only our own login (state-checked) may carry a post-login destination.
        const next = installRedirect ? null : safeNextPath(decodeURIComponent(cookie(request, 'openscan_next') ?? ''))
        const headers = new Headers({ location: next ?? landingPathFor(fresh) })
        headers.append('set-cookie', sessionCookieHeader(session, request.url))
        headers.append('set-cookie', 'openscan_oauth_state=; Path=/; Max-Age=0')
        headers.append('set-cookie', 'openscan_next=; Path=/; Max-Age=0')
        return new Response(null, { status: 302, headers })
      },
    },
  },
})
