import { createFileRoute } from '@tanstack/react-router'
import { str } from '#/lib/env'
import { hmacSha256Hex, timingSafeEqual } from '#/lib/crypto'
import { all, batch, now, run } from '#/lib/db'
import { repoUpsert, upsertInstallation, type GhInstallation, type GhRepo } from '#/lib/github/repos'
import { createScan, loadPreferences } from '#/lib/scanner/engine'

/** GitHub App webhook: keeps installations/repos in sync and triggers on-push reports. */
export const Route = createFileRoute('/api/github/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text()
        const secret = str('GITHUB_WEBHOOK_SECRET')
        const sig = request.headers.get('x-hub-signature-256') ?? ''
        if (!secret || !timingSafeEqual(sig, `sha256=${await hmacSha256Hex(secret, body)}`)) {
          return new Response('bad signature', { status: 401 })
        }
        const event = request.headers.get('x-github-event')
        const payload = JSON.parse(body)

        if (event === 'installation') {
          const inst = payload.installation as GhInstallation
          if (payload.action === 'deleted') {
            await run('DELETE FROM installations WHERE id = ?', inst.id)
            await run('DELETE FROM repositories WHERE installation_id = ?', inst.id)
          } else {
            await upsertInstallation(inst)
            const repos = (payload.repositories ?? []) as Array<Pick<GhRepo, 'id' | 'full_name' | 'private'>>
            await batch(repos.map((r) => repoUpsert({ default_branch: '', html_url: `https://github.com/${r.full_name}`, description: null, language: null, ...r }, inst.id)))
          }
        }

        if (event === 'installation_repositories') {
          const instId = payload.installation.id as number
          await upsertInstallation(payload.installation)
          const added = (payload.repositories_added ?? []) as Array<Pick<GhRepo, 'id' | 'full_name' | 'private'>>
          const removed = (payload.repositories_removed ?? []) as Array<{ id: number }>
          await batch([
            ...added.map((r) => repoUpsert({ default_branch: '', html_url: `https://github.com/${r.full_name}`, description: null, language: null, ...r }, instId)),
            // Make newly granted repos visible to every user linked to this installation.
            ...added.map((r): [string, Array<string | number | null>] => [
              `INSERT OR IGNORE INTO user_repositories (user_id, repo_id, selected, created_at)
               SELECT user_id, ?, 0, ? FROM user_installations WHERE installation_id = ?`,
              [r.id, now(), instId],
            ]),
            ...removed.map((r): [string, Array<string | number | null>] => ['DELETE FROM repositories WHERE id = ?', [r.id]]),
          ])
        }

        if (event === 'push' && payload.ref === `refs/heads/${payload.repository?.default_branch}`) {
          const watchers = await all<{ user_id: string }>(
            'SELECT user_id FROM user_repositories WHERE repo_id = ? AND selected = 1',
            payload.repository.id,
          )
          for (const w of watchers) {
            const prefs = await loadPreferences(w.user_id)
            if (prefs.frequency === 'on_push') await createScan(w.user_id, payload.repository.id, 'security', 'push')
          }
        }
        return new Response('ok')
      },
    },
  },
})
