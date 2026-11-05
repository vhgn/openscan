import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Empty, Lede, Margin, Page, SectionHead, Squiggle, plural, timeAgo } from '#/components/ui'
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
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<keyof typeof KIND_LABEL>('fact')
  const rows = d.memory.filter((m) => m.kind === tab)

  const save = async () => {
    setBusy(true)
    try {
      const { id } = await saveProductFn({ data: { id: d.product?.id, name: name.trim() || 'Untitled product', repoIds: members } })
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
      <Lede>Repositories in a product are reviewed together. Agents see each other&rsquo;s profiles, share your answers, and skip code that was already reviewed.</Lede>

      <SectionHead aside={`${members.length} selected`}>Repositories</SectionHead>
      <ul className="mt-4 border-y border-rule">
        {d.repos.length === 0 && <Empty>No repositories linked yet.</Empty>}
        {d.repos.map((r) => (
          <li key={r.id} className="border-t border-rule first:border-t-0">
            <label className="grid cursor-pointer grid-cols-[1.75rem_1fr_auto] items-baseline py-2.5">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={members.includes(r.id)}
                onChange={() => setMembers((m) => (m.includes(r.id) ? m.filter((x) => x !== r.id) : [...m, r.id]))}
              />
              <span className="text-[17px]">{r.fullName}</span>
              {r.otherProduct && !members.includes(r.id) && <span className="font-sans text-[12px] text-muted">in {r.otherProduct}; will move</span>}
            </label>
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
              disabled={busy || members.length === 0}
              onClick={async () => {
                setBusy(true)
                await scanProduct({ data: { productId: d.product!.id } })
                await router.navigate({ to: '/home' })
              }}
            >
              Review all {members.length}
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

      {d.product && (
        <>
          <SectionHead>Memory</SectionHead>
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
              <li key={m.id} className="grid grid-cols-[1fr_auto] items-baseline gap-4 border-t border-rule py-3 first:border-t-0">
                <span className="min-w-0">
                  <span className={`block ${m.kind === 'reviewed' ? 'truncate font-mono text-[13px]' : 'text-[17px] leading-[1.5]'}`}>
                    {m.kind === 'reviewed' ? m.key.slice(m.key.indexOf(':') + 1) : m.content}
                  </span>
                  <span className="block font-sans text-[12px] text-muted">
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
