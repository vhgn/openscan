import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { userFromRequest } from '#/lib/session'
import { listProductScans, listScans } from '#/lib/queries'
import { getProduct } from '#/lib/products'
import { startProductScan } from '#/lib/scanner/engine'
import { startScanFor } from '#/lib/actions'

const body = z.union([
  z.object({ productId: z.string() }),
  z.object({ repoId: z.number().int(), kind: z.enum(['understand', 'security']).default('security') }),
])

/**
 * REST: GET /api/scans (product scans with their repository scans, plus the flat list),
 * POST /api/scans {productId} reviews a product, {repoId, kind?} reviews one repo inside its product.
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
        const parsed = body.safeParse(await request.json().catch(() => ({})))
        if (!parsed.success) return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
        const data = parsed.data
        if ('productId' in data) {
          if (!(await getProduct(user.id, data.productId))) return Response.json({ error: 'product_not_found' }, { status: 404 })
          const started = await startProductScan(user.id, data.productId, 'manual')
          if (!started) return Response.json({ error: 'product_has_no_repositories' }, { status: 409 })
          return Response.json({ productScanId: started.id, scanIds: started.scanIds, url: `/products/${data.productId}` }, { status: 202 })
        }
        const id = await startScanFor(user.id, data.repoId, data.kind)
        if (!id) return Response.json({ error: 'repo_not_found' }, { status: 404 })
        return Response.json({ id, url: `/scans/${id}` }, { status: 202 })
      },
    },
  },
})
