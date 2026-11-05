import { createFileRoute } from '@tanstack/react-router'
import { userFromRequest } from '#/lib/session'
import { appUrl } from '#/lib/env'
import { jsonError } from '#/lib/http'
import { scanDetail } from '#/lib/queries'
import { sarifFilename, toSarif } from '#/lib/sarif'

/**
 * REST: GET /api/scans/:id/sarif → the security brief as SARIF 2.1.0, downloadable.
 * Upload it to GitHub code scanning (`github/codeql-action/upload-sarif`) or any SARIF tool.
 * Dismissed, fixed and validator-rejected findings are included as suppressed results.
 */
export const Route = createFileRoute('/api/scans/$scanId/sarif')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await userFromRequest(request)
        if (!user) return jsonError(401, 'unauthenticated')
        const detail = await scanDetail(user.id, params.scanId)
        if (!detail) return jsonError(404, 'not_found')
        if (detail.scan.kind !== 'security') return jsonError(409, 'not_a_security_scan')
        if (detail.scan.status !== 'completed') return jsonError(409, 'scan_not_completed', { status: detail.scan.status })
        const { scan } = detail
        const log = toSarif(
          { ...scan, summary: scan.summary ? { riskLevel: scan.summary.riskLevel, headline: scan.summary.headline } : null },
          detail.findings,
          { informationUri: appUrl() },
        )
        return new Response(JSON.stringify(log, null, 2), {
          headers: {
            'content-type': 'application/sarif+json; charset=utf-8',
            'content-disposition': `attachment; filename="${sarifFilename(scan)}"`,
            'cache-control': 'private, no-store',
          },
        })
      },
    },
  },
})
