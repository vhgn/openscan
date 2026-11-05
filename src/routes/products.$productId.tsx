import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Empty, TopBar, timeAgo } from '#/components/ui'
import { deleteProductFn, forgetMemoryFn, getProductPage, saveProductFn, scanProduct } from '#/server-fns/app'

export const Route = createFileRoute('/products/$productId')({
  loader: ({ params }) => getProductPage({ data: { id: params.productId } }),
  head: () => ({ meta: [{ title: 'Product — openscan' }] }),
  component: ProductPage,
})

const KIND_LABEL = { fact: 'Facts', reviewed: 'Reviewed files', verdict: 'Validator verdicts' } as const
const KIND_HELP = {
  fact: 'Durable knowledge every agent in this product starts with: profile facts, unenforced assumptions, and your answers.',
  reviewed: 'Files reviewed at a specific git blob hash. Unchanged files are skipped on the next scans.',
  verdict: 'Confirmed / rejected claims. The same claim on unchanged code keeps its verdict instead of being re-validated.',
} as const

function ProductPage() {
  const d = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState(d.product?.name ?? '')
  const [members, setMembers] = useState<number[]>(d.repos.filter((r) => r.member).map((r) => r.id))
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'fact' | 'reviewed' | 'verdict'>('fact')
  const rows = d.memory.filter((m) => m.kind === tab)

  const save = async () => {
    setBusy(true)
    const { id } = await saveProductFn({ data: { id: d.product?.id, name: name.trim() || 'Untitled product', repoIds: members } })
    setBusy(false)
    if (!d.product) await router.navigate({ to: '/products/$productId', params: { productId: id } })
    else await router.invalidate()
  }

  return (
    <div className="min-h-screen">
      <TopBar
        user={d.user}
        right={
          <Link to="/dashboard" className="muted hover:underline">
            ← Dashboard
          </Link>
        }
      />
      <main className="mx-auto max-w-5xl space-y-10 px-4 py-10">
        <section className="grid gap-8 md:grid-cols-[1fr_280px]">
          <div>
            <p className="muted text-xs uppercase tracking-wide">{d.product ? 'Product' : 'New product'}</p>
            <input className="mt-1 w-full bg-transparent text-2xl font-bold tracking-tight outline-none" value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" />
            <p className="muted mt-1 text-sm">Repositories in a product are reviewed together: agents see each other's profiles, share your answers, and skip code that was already reviewed.</p>
            <ul className="app-card mt-5 divide-y divide-[var(--line)]">
              {d.repos.length === 0 && <Empty>No repositories linked yet.</Empty>}
              {d.repos.map((r) => (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--accent)]"
                      checked={members.includes(r.id)}
                      onChange={() => setMembers((m) => (m.includes(r.id) ? m.filter((x) => x !== r.id) : [...m, r.id]))}
                    />
                    <span className="flex-1">{r.fullName}</span>
                    {r.otherProduct && !members.includes(r.id) && <span className="muted text-xs">in "{r.otherProduct}" (will move)</span>}
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn btn-primary" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : d.product ? 'Save product' : 'Create product'}
              </button>
              {d.product && (
                <>
                  <button
                    className="btn btn-ghost"
                    disabled={busy || members.length === 0}
                    onClick={async () => {
                      setBusy(true)
                      await scanProduct({ data: { productId: d.product!.id } })
                      await router.navigate({ to: '/dashboard' })
                    }}
                  >
                    Scan all {members.length} repositories
                  </button>
                  <button
                    className="muted px-2 text-xs underline"
                    onClick={async () => {
                      if (!confirm('Delete this product and its memory? Scans and findings are kept.')) return
                      await deleteProductFn({ data: { id: d.product!.id } })
                      await router.navigate({ to: '/dashboard' })
                    }}
                  >
                    delete product
                  </button>
                </>
              )}
            </div>
          </div>
          {d.product && (
            <aside className="app-card h-fit p-4 text-sm">
              <p className="font-semibold">Product memory</p>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                {(
                  [
                    ['Facts', d.stats.facts],
                    ['Reviewed files', d.stats.reviewed],
                    ['Verdicts', d.stats.verdicts],
                    ['Re-checks avoided', d.stats.saved],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="muted text-xs">{k}</dt>
                    <dd className="text-xl font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
            </aside>
          )}
        </section>

        {d.product && (
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {(Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>).map((k) => (
                <button key={k} onClick={() => setTab(k)} className={`rounded-full border px-3 py-1 text-xs ${tab === k ? 'border-[var(--accent)]' : 'hairline muted'}`}>
                  {KIND_LABEL[k]} ({d.memory.filter((m) => m.kind === k).length})
                </button>
              ))}
              {rows.length > 0 && (
                <button
                  className="muted ml-auto text-xs underline"
                  onClick={async () => {
                    await forgetMemoryFn({ data: { productId: d.product!.id, kind: tab } })
                    await router.invalidate()
                  }}
                >
                  forget all {KIND_LABEL[tab].toLowerCase()}
                </button>
              )}
            </div>
            <p className="muted mb-3 text-xs">{KIND_HELP[tab]}</p>
            <ul className="app-card divide-y divide-[var(--line)] text-sm">
              {rows.length === 0 && <Empty>Nothing remembered yet. Memory fills in as scans run.</Empty>}
              {rows.map((m) => (
                <li key={m.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block">{m.kind === 'reviewed' ? m.key.slice(m.key.indexOf(':') + 1) : m.content}</span>
                    <span className="muted block text-xs">
                      {m.repo ?? 'product-wide'}
                      {m.kind === 'reviewed' ? ` · ${m.content}` : ''}
                      {m.hits ? ` · reused ${m.hits}×` : ''} · {timeAgo(m.updatedAt)}
                    </span>
                  </span>
                  <button
                    className="muted text-xs underline"
                    onClick={async () => {
                      await forgetMemoryFn({ data: { productId: d.product!.id, memoryId: m.id } })
                      await router.invalidate()
                    }}
                  >
                    forget
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
