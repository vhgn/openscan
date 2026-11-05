import { createFileRoute } from '@tanstack/react-router'
import { isDemoLoginEnabled } from '#/lib/env'
import { batch, now } from '#/lib/db'
import { gh } from '#/lib/github/app'
import { publicTree, repoUpsert, type GhRepo } from '#/lib/github/repos'
import { createSession, sessionCookieHeader } from '#/lib/session'
import { landingPathFor, upsertGithubUser } from '#/lib/users'

/**
 * DEV ONLY (DEV_DEMO_LOGIN=1): signs in a fake GitHub user and links public
 * repositories (read anonymously), so the whole flow can be tried without
 * creating a GitHub App. ?repos=owner/a,owner/b
 */
function hashId(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0
  return Math.abs(h) || 1
}

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
        const ops: Array<[string, Array<string | number | null>]> = []
        for (const name of names) {
          try {
            const r = await gh<GhRepo>(`/repos/${name}`, null).catch(async (e) => {
              // Anonymous API rate-limited: fall back to a synthetic record if the repo is public on jsDelivr.
              for (const branch of ['main', 'master']) {
                if ((await publicTree(name, branch))?.length) {
                  return { id: hashId(name), full_name: name, default_branch: branch, private: false, html_url: `https://github.com/${name}`, description: null, language: null } satisfies GhRepo
                }
              }
              throw e
            })
            // Negative ids mark anonymous/public demo repos (no installation).
            const demo = { ...r, id: -Math.abs(r.id) }
            ops.push(repoUpsert(demo, null))
            ops.push(['INSERT OR IGNORE INTO user_repositories (user_id, repo_id, selected, created_at) VALUES (?, ?, 0, ?)', [user.id, demo.id, now()]])
          } catch (e) {
            console.error('demo repo lookup failed', name, e)
          }
        }
        await batch(ops)
        const session = await createSession(user.id)
        return new Response(null, {
          status: 302,
          headers: { location: landingPathFor(user), 'set-cookie': sessionCookieHeader(session, request.url) },
        })
      },
    },
  },
})
