import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Empty, Lede, Margin, Page, SectionHead, Severity, StatusMark, Title, plural, spell } from '#/components/ui'
import { QuestionCard } from '#/components/QuestionCard'
import { Select } from '#/components/Select'
import { FindingFilters, applyFindingFilters, type FindingFilterState } from '#/components/FindingFilters'
import { ProductScans, isLive } from '#/components/ProductScans'
import { scanProduct, type DashboardData } from '#/server-fns/app'


const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info']
const FREQ_PHRASE: Record<string, string> = {
  on_push: 'on every push',
  daily: 'every morning',
  weekly: 'every Monday',
  monthly: 'once a month',
  manual: 'only when you ask',
}
const DEPTH_PHRASE: Record<string, string> = {
  triage: 'a quick triage',
  standard: 'a standard review',
  deep_poc: 'deep research, with a proof of concept for every serious finding',
}

function headline(n: number, urgent: number, open: number) {
  if (n === 0 && open === 0) return 'Nothing needs your attention this week.'
  if (urgent > 0) return `${spell(urgent)[0].toUpperCase()}${spell(urgent).slice(1)} finding${urgent === 1 ? '' : 's'} should be fixed now.`
  if (n > 0) return `${spell(n)[0].toUpperCase()}${spell(n).slice(1)} finding${n === 1 ? '' : 's'} worth a look, nothing urgent.`
  return `${spell(open)[0].toUpperCase()}${spell(open).slice(1)} question${open === 1 ? '' : 's'} only you can answer.`
}

/** The signed-in brief, shown on /home once setup is done. */
export function Brief({ data }: { data: DashboardData }) {
  const router = useRouter()
  const running = data.productScans.filter(isLive)
  useEffect(() => {
    if (!running.length) return
    const t = setInterval(() => router.invalidate(), 4000)
    return () => clearInterval(t)
  }, [running.length, router])
  const [productId, setProductId] = useState<string | undefined>((data.products.find((p) => p.repos > 0) ?? data.products[0])?.id)
  const product = data.products.find((p) => p.id === productId)
  const [busy, setBusy] = useState<string | null>(null)
  const minIdx = SEV_ORDER.indexOf(data.preferences.minSeverity)
  const visible = data.findings.filter((f) => SEV_ORDER.indexOf(f.severity) <= minIdx)
  const [filters, setFilters] = useState<FindingFilterState>({})
  const findings = applyFindingFilters(visible, filters)
  const hidden = data.findings.length - visible.length
  const urgent = visible.filter((f) => f.severity === 'critical' || f.severity === 'high').length
  const codex = data.repos.filter((r) => r.codexEnv).length
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <Page user={data.user}>
      <p className="label">Security overview · {today}</p>
      <Title>{headline(visible.length, urgent, data.questions.length)}</Title>
      <Lede>
        openscan watches {plural(data.repos.length, 'repository', 'repositories')} and writes a brief {FREQ_PHRASE[data.preferences.frequency] ?? data.preferences.frequency}, backed by{' '}
        {DEPTH_PHRASE[data.preferences.depth] ?? data.preferences.depth}.{' '}
        {data.user.chatgpt ? (
          <>
            Inference runs on your ChatGPT{data.user.chatgpt.plan ? ` ${data.user.chatgpt.plan}` : ''} plan
            {codex > 0 ? `, and agents work in Codex Cloud for ${codex} of them` : ''}.
          </>
        ) : (
          <>
            ChatGPT isn&rsquo;t connected, so the built-in analyzer does the reading.{' '}
            <Link to="/settings" className="link">
              Connect it
            </Link>{' '}
            for a real review.
          </>
        )}
      </Lede>

      {running.length > 0 && (
        <p className="mt-6 flex items-center gap-2 font-sans text-[13px] text-muted">
          <StatusMark status="running" /> {running.length === 1 ? 'A review is' : `${running.length} reviews are`} in progress:{' '}
          {running.map((ps, i) => (
            <span key={ps.id}>
              {i > 0 && ', '}
              <Link to="/products/$productId" params={{ productId: ps.product_id }} className="link text-ink-3">
                {ps.product} ({ps.progress}%)
              </Link>
            </span>
          ))}
        </p>
      )}

      <form
        className="mt-8 flex flex-wrap items-end gap-3 font-sans text-[14px]"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!product) return
          setBusy('scan')
          try {
            const { scanIds } = await scanProduct({ data: { productId: product.id } })
            // One repository: straight to its brief. Several: the product page follows them all.
            if (scanIds.length === 1) await router.navigate({ to: '/scans/$scanId', params: { scanId: scanIds[0] } })
            else await router.navigate({ to: '/products/$productId', params: { productId: product.id } })
          } finally {
            setBusy(null)
          }
        }}
      >
        <span className="pb-1.5 text-muted">Run a fresh review of</span>
        {data.products.length > 0 ? (
          <Select
            size="sans"
            className="max-w-[18rem] pb-1"
            label="Product"
            value={productId ?? ''}
            onChange={(v) => setProductId(v)}
            options={data.products.map((p) => ({ value: p.id, label: p.name, hint: plural(p.repos, 'repo') }))}
          />
        ) : (
          <Link to="/products/$productId" params={{ productId: 'new' }} className="link pb-1.5">
            a new product
          </Link>
        )}
        <button className="btn btn-sm" disabled={!product || product.repos === 0 || busy !== null}>
          {busy === 'scan' ? 'Starting…' : 'Start'}
        </button>
      </form>

      {data.questions.length > 0 && (
        <>
          <SectionHead aside="It couldn’t settle these from the code">Questions for you</SectionHead>
          <div className="mt-5 space-y-7">
            {data.questions.map((q) => (
              <QuestionCard key={q.id} q={q} />
            ))}
          </div>
        </>
      )}

      <SectionHead aside={hidden > 0 ? `${hidden} below ${data.preferences.minSeverity} hidden` : 'Latest brief per repository'}>Open findings</SectionHead>
      <FindingFilters items={visible} value={filters} onChange={setFilters} />
      <ol className="mt-4">
        {visible.length === 0 && <Empty>No open findings.</Empty>}
        {visible.length > 0 && findings.length === 0 && <Empty>No open findings match these filters.</Empty>}
        {findings.map((f) => (
          <li key={f.id} className="border-t border-rule first:border-t-0">
            <Link to="/scans/$scanId" params={{ scanId: f.scan_id }} hash={`f-${f.id}`} className="group grid gap-1 py-4 sm:grid-cols-[6.5rem_1fr] sm:gap-4">
              <span className="pt-1.5">
                <Severity severity={f.severity} />
              </span>
              <span className="min-w-0">
                <span className="block text-[19px] leading-[1.4] group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">{f.title}</span>
                <span className="mt-0.5 block truncate font-sans text-[12.5px] text-muted">
                  {f.repo}
                  {f.file && (
                    <>
                      {' '}
                      · <span className="font-mono">{f.file}{f.line ? `:${f.line}` : ''}</span>
                    </>
                  )}
                  {f.verdict === 'confirmed' && ' · verified'}
                  {f.poc && ' · proof of concept'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <SectionHead
        aside={
          <Link to="/products/$productId" params={{ productId: 'new' }} className="link">
            New product
          </Link>
        }
      >
        Products
      </SectionHead>
      <div className="mt-4 space-y-6">
        {data.products.length === 0 && <Empty>No products yet.</Empty>}
        {data.products.map((p) => (
          <div key={p.id} className="relative border-t border-rule pt-4 first:border-t-0 first:pt-0">
            <Link to="/products/$productId" params={{ productId: p.id }} className="font-display text-[28px] leading-tight hover:underline hover:decoration-1 hover:underline-offset-4">
              {p.name}
            </Link>
            <p className="mt-1 text-[17px] leading-[1.55] text-ink-3">
              {plural(p.repos, 'repository', 'repositories')}
              {p.repos > 0 && (p.pushRepos === 0 ? ', none reviewed on push' : p.pushRepos === p.repos ? ', each reviewed on push' : `, ${p.pushRepos} reviewed on push`)}. Its memory holds{' '}
              {plural(p.memory.facts, 'fact')}, {plural(p.memory.reviewed, 'reviewed file')} and {plural(p.memory.verdicts, 'verdict')}.
            </p>
            {p.memory.saved > 0 && <Margin>Memory has saved {plural(p.memory.saved, 're-check')} so far.</Margin>}
          </div>
        ))}
      </div>

      <SectionHead aside="One review per product, one brief per repository">Earlier reviews</SectionHead>
      <ProductScans items={data.productScans} empty="No reviews yet." />
    </Page>
  )
}
