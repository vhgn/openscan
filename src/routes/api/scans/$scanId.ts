import { createFileRoute } from '@tanstack/react-router'
import { userFromRequest } from '#/lib/session'
import { jsonError, jsonWithEtag } from '#/lib/http'
import { scanDetail } from '#/lib/queries'

/**
 * REST: GET /api/scans/:id → status, progress, event log, summary, findings, questions.
 * Sends an ETag; repeat the request with If-None-Match to get 304 while nothing changed.
 * To follow a running scan cheaply, poll /api/scans/:id/progress instead.
 */
export const Route = createFileRoute('/api/scans/$scanId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await userFromRequest(request)
        if (!user) return jsonError(401, 'unauthenticated')
        const detail = await scanDetail(user.id, params.scanId)
        if (!detail) return jsonError(404, 'not_found')
        return jsonWithEtag(request, detail)
      },
    },
  },
})
