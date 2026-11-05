import { createFileRoute } from '@tanstack/react-router'
import { userFromRequest } from '#/lib/session'
import { scanDetail } from '#/lib/queries'

/** REST: GET /api/scans/:id → status, progress, event log, summary, findings, questions. */
export const Route = createFileRoute('/api/scans/$scanId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await userFromRequest(request)
        if (!user) return Response.json({ error: 'unauthenticated' }, { status: 401 })
        const detail = await scanDetail(user.id, params.scanId)
        if (!detail) return Response.json({ error: 'not_found' }, { status: 404 })
        return Response.json(detail)
      },
    },
  },
})
