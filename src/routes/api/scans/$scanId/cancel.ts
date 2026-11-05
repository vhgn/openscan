import { createFileRoute } from '@tanstack/react-router'
import { userFromRequest } from '#/lib/session'
import { jsonError } from '#/lib/http'
import { cancelScan } from '#/lib/scanner/engine'

/**
 * REST: POST /api/scans/:id/cancel → 200 {id, status:"cancelled"}.
 * 409 {error:"not_active", status} if the scan already finished; 404 if it isn't yours.
 */
export const Route = createFileRoute('/api/scans/$scanId/cancel')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const user = await userFromRequest(request)
        if (!user) return jsonError(401, 'unauthenticated')
        const result = await cancelScan(user.id, params.scanId)
        if (result.ok) return Response.json({ id: params.scanId, status: 'cancelled' })
        if (result.reason === 'not_found') return jsonError(404, 'not_found')
        return jsonError(409, 'not_active', { status: result.status })
      },
    },
  },
})
