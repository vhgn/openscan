import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Empty, Lede, Margin, Page, SectionHead, Squiggle, plural, timeAgo } from '#/components/ui'
import { ProductScans, isLive } from '#/components/ProductScans'
import { deleteProductFn, forgetMemoryFn, getProductPage, saveProductFn, scanProduct } from '#/server-fns/app'

export const Route = createFileRoute('/products/$productId')({
  loader: ({ params }) => getProductPage({ data: { id: params.productId } }),
  head: () => ({ meta: [{ title: 'Product — openscan' }] }),
  component: ProductPage,
})

const KIND_LABEL = { fact: 'Facts', reviewed: 'Reviewed files', verdict: 'Verdicts' } as const
const KIND_HELP = {
  fact: 'What every agent in this product starts with: profile facts, assumptions nothing in the code enforces, and your answers.',
  reviewed: 'Files reviewed at a specific git blob hash. Unchanged files are skipped on later scans; any change sends them back through review.',
  verdict: 'Confirmed and rejected claims. The same claim on unchanged code keeps its verdict instead of being validated again.',
} as const

function ProductPage() {
  const d = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState(d.product?.name ?? '')
  const [members, setMembers] = useState<number[]>(d.repos.filter((r) => r.member).map((r) => r.id))
  const [onPush, setOnPush] = useState<number[]>(d.repos.filter((r) => r.scanOnPush).map((r) => r.id))
  const [error, setError] = useState<string | null>(null)
  const live = d.productScans.some(isLive)
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => router.invalidate(), 3000)
    return () => clearInterval(t)
  }, [live, router])
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<keyof typeof KIND_LABEL>('fact')
  const rows = d.memory.filter((m) => m.kind === tab)

  const save = async () => {
    setBusy(true)
    try {
      const { id } = await saveProductFn({
        data: { id: d.product?.id, name: name.trim() || 'Untitled product', repoIds: members, pushRepoIds: onPush.filter((r) => members.includes(r)) },
      })
      if (!d.product) await router.navigate({ to: '/products/$productId', params: { productId: id } })
      else await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page user={d.user} crumb={d.product?.name ?? 'New product'}>
      <p className="label">{d.product ? 'Product' : 'New product'}</p>
      <input
        className="field mt-3 font-display text-[44px] leading-[1.1] sm:text-[56px]"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name this product"
        aria-label="Product name"
      />
      <Lede>
        A product owns its reviews: each one scans its repositories together, so agents see each other&rsquo;s profiles, share your answers, and skip code that was already reviewed.
        A push to a repository marked <em>on push</em> starts a review of that repository inside the product.
      </Lede>

      <SectionHead aside={`${members.length} selected`} hint="A repository belongs to one product at a time. Picking one that is in another product moves it here.">Repositories</SectionHead>
      {/* Fixed height, scrolls inside; repos that were already in the product when the page opened come first. */}
      <ul className="mt-4 max-h-[22rem] overflow-y-auto overscroll-contain border-y border-rule pr-1">
        {d.repos.length === 0 && <Empty>No repositories linked yet.</Empty>}
        {[...d.repos].sort((a, b) => Number(b.member) - Number(a.member)).map((r) => (
          <li key={r.id} className="border-t border-rule first:border-t-0">
            <div className="grid grid-cols-[1fr_auto] items-baseline gap-4 py-2.5">
              <label className="grid cursor-pointer grid-cols-[1.75rem_1fr] items-baseline">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={members.includes(r.id)}
                  onChange={() => setMembers((m) => (m.includes(r.id) ? m.filter((x) => x !== r.id) : [...m, r.id]))}
                />
                <span className="min-w-0 text-[17px]">
                  {r.fullName}
                  {r.otherProduct && !members.includes(r.id) && <span className="ml-2 font-sans text-[12px] text-muted">in {r.otherProduct}; will move</span>}
                </span>
              </label>
              {members.includes(r.id) && (
                <label className="flex cursor-pointer items-center gap-2 font-sans text-[12.5px] text-muted" title="A push to the default branch starts a review of this repository in the product">
                  <input
                    type="checkbox"
                    className="h-3 w-3"
                    checked={onPush.includes(r.id)}
                    onChange={() => setOnPush((m) => (m.includes(r.id) ? m.filter((x) => x !== r.id) : [...m, r.id]))}
                  />
                  on push
                </label>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button className="btn" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : d.product ? 'Save product' : 'Create product'}
        </button>
        {d.product && (
          <>
            <button
              className="btn btn-quiet"
              disabled={busy || d.repos.every((r) => !r.member)}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await scanProduct({ data: { productId: d.product!.id } })
                  await router.invalidate()
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              Review {d.product.name}
            </button>
            <button
              className="ml-2 font-sans text-[12.5px] text-muted underline underline-offset-4 hover:text-alarm"
              onClick={async () => {
                if (!confirm('Delete this product and its memory? Scans and findings are kept.')) return
                await deleteProductFn({ data: { id: d.product!.id } })
                await router.navigate({ to: '/home' })
              }}
            >
              Delete product
            </button>
          </>
        )}
      </div>

      {error && <p className="mt-3 font-sans text-[13px] text-alarm">{error}</p>}

      {d.product && (
        <>
          <SectionHead aside={live ? 'In progress' : undefined} hint="Each review scans this product’s repositories together. A push to a repository marked on push reviews just that repository.">Reviews</SectionHead>
          <ProductScans items={d.productScans} showProduct={false} empty="No reviews of this product yet." />

          <SectionHead hint="What this product’s agents remember so they don’t re-check the same things: facts and your answers, files already reviewed at the same version, and earlier verdicts on the same code.">Memory</SectionHead>
          <div className="relative mt-4 text-[19px] leading-[1.65] text-ink-2">
            This product remembers {plural(d.stats.facts, 'fact')}, {plural(d.stats.reviewed, 'reviewed file')} and {plural(d.stats.verdicts, 'verdict')}
            {d.stats.saved > 0 ? (
              <>
                , and has saved <span className="squiggle italic">{plural(d.stats.saved, 're-check')}</span> so far
              </>
            ) : null}
            .
            <Margin>Forget anything here and the next scan looks at it again from scratch.</Margin>
          </div>

          <p className="mt-8 flex flex-wrap items-baseline gap-x-5 gap-y-2 font-sans text-[13px]">
            {(Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>).map((k) => (
              <button key={k} onClick={() => setTab(k)} className={tab === k ? 'font-medium text-ink' : 'text-muted hover:text-ink'}>
                <Squiggle on={tab === k}>
                  {KIND_LABEL[k]} ({d.memory.filter((m) => m.kind === k).length})
                </Squiggle>
              </button>
            ))}
            {rows.length > 0 && (
              <button
                className="ml-auto text-muted underline underline-offset-4 hover:text-ink"
                onClick={async () => {
                  if (!confirm(`Forget all ${KIND_LABEL[tab].toLowerCase()}?`)) return
                  await forgetMemoryFn({ data: { productId: d.product!.id, kind: tab } })
                  await router.invalidate()
                }}
              >
                Forget all
              </button>
            )}
          </p>
          <p className="mt-2 font-sans text-[13px] leading-snug text-muted">{KIND_HELP[tab]}</p>
          <ul className="mt-4">
            {rows.length === 0 && <Empty>Nothing remembered yet. Memory fills in as scans run.</Empty>}
            {rows.map((m) => (
              <li key={m.id} className="grid grid-cols-[1fr_auto] items-baseline gap-4 border-t border-rule py-4 first:border-t-0">
                <span className="min-w-0">
                  <span className={`block ${m.kind === 'reviewed' ? 'truncate font-mono text-[13px]' : 'text-[17px] leading-[1.4]'}`}>
                    {m.kind === 'reviewed' ? m.key.slice(m.key.indexOf(':') + 1) : m.content}
                  </span>
                  <span className="mt-0.5 block font-sans text-[12px] text-muted">
                    {m.repo ?? 'product-wide'}
                    {m.kind === 'reviewed' ? ` · ${m.content}` : ''}
                    {m.hits ? ` · reused ${m.hits}×` : ''} · {timeAgo(m.updatedAt)}
                  </span>
                </span>
                <button
                  className="font-sans text-[12px] text-muted underline underline-offset-4 hover:text-ink"
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
        </>
      )}
    </Page>
  )
}
