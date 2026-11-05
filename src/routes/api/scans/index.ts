import { createFileRoute } from '@tanstack/react-router'
import { userFromRequest } from '#/lib/session'
import { listProductScans, listScans } from '#/lib/queries'
import { getProduct } from '#/lib/products'
import { startProductScan } from '#/lib/scanner/engine'
import { startScanFor } from '#/lib/actions'
import { StartScanBody } from '#/lib/api/contract'

const START_SCAN_ERRORS = {
  invalid: { code: 'invalid_repo', status: 400 },
  not_found: { code: 'repo_not_found', status: 404 },
  private: { code: 'repo_private', status: 404 },
  unavailable: { code: 'github_unavailable', status: 503 },
  not_started: { code: 'scan_not_started', status: 409 },
} as const

/**
 * REST: GET /api/scans (product scans with their repository scans, plus the flat list),
 * POST /api/scans {productId} reviews a product; {repo: "owner/name"} or {repoId}, plus kind?, reviews one repo inside its product.
 * Schemas (and public/openapi.json): src/lib/api/contract.ts.
 */
export const Route = createFileRoute('/api/scans/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await userFromRequest(request)
        if (!user) return Response.json({ error: 'unauthenticated' }, { status: 401 })
        return Response.json({ productScans: await listProductScans(user.id, { limit: 50 }), scans: await listScans(user.id, 100) })
      },
      POST: async ({ request }) => {
        const user = await userFromRequest(request)
        if (!user) return Response.json({ error: 'unauthenticated' }, { status: 401 })
        const parsed = StartScanBody.safeParse(await request.json().catch(() => ({})))
        if (!parsed.success) return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
        const data = parsed.data
        if ('productId' in data) {
          if (!(await getProduct(user.id, data.productId))) return Response.json({ error: 'product_not_found' }, { status: 404 })
          const started = await startProductScan(user.id, data.productId, 'manual')
          if (!started) return Response.json({ error: 'product_has_no_repositories' }, { status: 409 })
          return Response.json({ productScanId: started.id, scanIds: started.scanIds, url: `/products/${data.productId}` }, { status: 202 })
        }
        const r = await startScanFor(user.id, 'repo' in data ? data.repo : data.repoId, data.kind)
        if (!r.ok) return Response.json({ error: START_SCAN_ERRORS[r.error].code, message: r.message }, { status: START_SCAN_ERRORS[r.error].status })
        return Response.json({ id: r.id, repo: r.repo, url: `/scans/${r.id}` }, { status: 202 })
      },
    },
  },
})
