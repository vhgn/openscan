import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { userFromRequest } from '#/lib/session'
import { first } from '#/lib/db'
import { listScans } from '#/lib/queries'
import { createScan } from '#/lib/scanner/engine'

const body = z.object({ repoId: z.number().int(), kind: z.enum(['understand', 'security']).default('security') })

/** REST: GET /api/scans (list), POST /api/scans {repoId, kind?} (start). */
export const Route = createFileRoute('/api/scans/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await userFromRequest(request)
        if (!user) return Response.json({ error: 'unauthenticated' }, { status: 401 })
        return Response.json({ scans: await listScans(user.id, 100) })
      },
      POST: async ({ request }) => {
        const user = await userFromRequest(request)
        if (!user) return Response.json({ error: 'unauthenticated' }, { status: 401 })
        const parsed = body.safeParse(await request.json().catch(() => ({})))
        if (!parsed.success) return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
        const link = await first('SELECT 1 FROM user_repositories WHERE user_id = ? AND repo_id = ?', user.id, parsed.data.repoId)
        if (!link) return Response.json({ error: 'repo_not_found' }, { status: 404 })
        const id = await createScan(user.id, parsed.data.repoId, parsed.data.kind, 'manual')
        return Response.json({ id, url: `/scans/${id}` }, { status: 202 })
      },
    },
  },
})
