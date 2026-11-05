import { createFileRoute } from '@tanstack/react-router'
import { userFromRequest } from '#/lib/session'
import { jsonError, jsonWithEtag } from '#/lib/http'
import { scanProgress } from '#/lib/queries'

/**
 * REST: GET /api/scans/:id/progress?since=<eventId>
 * → {status, phase, progress, live, updated_at, events (only after `since`), cursor}.
 * Small and ETag'd: poll it every couple of seconds and pass `cursor` back as `since`.
 */
export const Route = createFileRoute('/api/scans/$scanId/progress')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await userFromRequest(request)
        if (!user) return jsonError(401, 'unauthenticated')
        const raw = new URL(request.url).searchParams.get('since')
        const since = raw === null ? 0 : Number(raw)
        if (!Number.isSafeInteger(since) || since < 0) return jsonError(400, 'invalid_since')
        const progress = await scanProgress(user.id, params.scanId, since)
        if (!progress) return jsonError(404, 'not_found')
        return jsonWithEtag(request, progress)
      },
    },
  },
})
