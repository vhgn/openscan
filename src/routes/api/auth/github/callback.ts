import { createFileRoute } from '@tanstack/react-router'
import { exchangeCode, gh, storeUserToken } from '#/lib/github/app'
import { syncUserRepos } from '#/lib/github/repos'
import { createSession, readCookie, sessionCookieHeader } from '#/lib/session'
import { landingPathFor, upsertGithubUser } from '#/lib/users'
import { first } from '#/lib/db'
import type { UserRow } from '#/lib/types'
import { safeNextPath } from '#/lib/redirect'

export const Route = createFileRoute('/api/auth/github/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        // A code is only ever exchanged for a session when `state` matches the cookie set by our own login.
        // Without that check, anyone could send a victim here with the attacker's own code and sign them
        // into the attacker's account (login CSRF), e.g. so the victim's ChatGPT connection lands there.
        // GitHub's "request user authorization during installation" redirect carries installation_id but no
        // state; we never sign in from it and hand it to the Setup URL, which uses the existing session or
        // starts a state-checked login.
        if (!state && url.searchParams.has('installation_id')) {
          return new Response(null, { status: 302, headers: { location: '/api/github/setup' } })
        }
        if (!code || !state || state !== readCookie(request, 'openscan_oauth_state')) {
          return new Response('Invalid OAuth state. Please try signing in again.', { status: 400 })
        }
        const token = await exchangeCode(code)
        const profile = await gh<{ id: number; login: string; name: string | null; avatar_url: string | null }>('/user', token.accessToken)
        const user = await upsertGithubUser(profile)
        await storeUserToken(user.id, token)
        const fresh = (await first<UserRow>('SELECT * FROM users WHERE id = ?', user.id))!
        await syncUserRepos(fresh).catch((e) => console.error('repo sync failed', e))
        const session = await createSession(user.id)
        const next = safeNextPath(readCookie(request, 'openscan_next') ?? '')
        const headers = new Headers({ location: next ?? landingPathFor(fresh) })
        headers.append('set-cookie', sessionCookieHeader(session, request.url))
        headers.append('set-cookie', 'openscan_oauth_state=; Path=/; Max-Age=0')
        headers.append('set-cookie', 'openscan_next=; Path=/; Max-Age=0')
        return new Response(null, { status: 302, headers })
      },
    },
  },
})
