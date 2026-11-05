import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { LANDING_DESIGNS } from '#/components/landing'
import { REPORT_DESIGNS, SAMPLE_REPORT } from '#/components/report-designs'
import { approveDesign, getDesign } from '#/server-fns/app'

type DesignKey = keyof typeof LANDING_DESIGNS

export const Route = createFileRoute('/design')({
  validateSearch: (s: Record<string, unknown>): { preview?: DesignKey; page?: 'report' } => ({
    ...(typeof s.preview === 'string' && s.preview in LANDING_DESIGNS ? { preview: s.preview as DesignKey } : {}),
    ...(s.page === 'report' ? { page: 'report' as const } : {}),
  }),
  loader: () => getDesign(),
  head: () => ({ meta: [{ title: 'Pick a landing design — openscan' }] }),
  component: DesignPicker,
})

function DesignPicker() {
  const data = Route.useLoaderData()
  const { preview, page } = Route.useSearch()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const keys = Object.keys(LANDING_DESIGNS) as DesignKey[]

  // Full-page preview of a single option (?preview=essay, or &page=report for the signed-in report)
  if (preview) {
    const D = LANDING_DESIGNS[preview]
    const Report = REPORT_DESIGNS[preview]
    return (
      <div className="relative">
        <div className="fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-black/10 bg-white/95 px-3 py-1.5 text-sm text-stone-800 shadow-lg backdrop-blur">
          <a href="/design" className="font-medium hover:underline">
            ← All options
          </a>
          <span className="text-stone-400">|</span>
          <span className="font-semibold">{D.name}</span>
          <a href={page === 'report' ? `/design?preview=${preview}` : `/design?preview=${preview}&page=report`} className="hover:underline">
            {page === 'report' ? 'Landing' : 'Report page'}
          </a>
          <ApproveButton id={preview} />
        </div>
        {page === 'report' ? <Report data={SAMPLE_REPORT} /> : <D.Component cta={{ href: '#', label: 'Connect GitHub — it’s free' }} secondary={{ href: '#', label: 'How it works' }} />}
      </div>
    )
  }

  function ApproveButton({ id }: { id: DesignKey }) {
    const approved = data.approved === id
    if (approved) return <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">✓ Approved</span>
    if (!data.signedIn)
      return (
        <a href="/api/auth/github/login" className="rounded-full bg-stone-900 px-3 py-1 text-xs font-bold text-white">
          Sign in to approve
        </a>
      )
    return (
      <button
        disabled={!data.canApprove || busy !== null}
        onClick={async () => {
          setBusy(id)
          setError(null)
          try {
            await approveDesign({ data: { design: id } })
            await router.invalidate()
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          } finally {
            setBusy(null)
          }
        }}
        className="rounded-full bg-stone-900 px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
      >
        {busy === id ? 'Approving…' : 'Approve this one'}
      </button>
    )
  }

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <header className="mx-auto max-w-7xl px-6 pb-6 pt-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">/design</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Pick the landing page</h1>
        <p className="mt-2 max-w-2xl text-stone-600">
          Two styles, each shown as the public landing page and the signed-in report page. Open either full-screen, then approve one — it becomes the page at <code>/</code> immediately.
          {data.approved && (
            <>
              {' '}
              Current choice: <strong>{LANDING_DESIGNS[data.approved].name}</strong>
              {data.approvedBy ? ` (by @${data.approvedBy})` : ''}.
            </>
          )}
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </header>
      <main className="mx-auto grid max-w-7xl gap-8 px-6 pb-16 lg:grid-cols-2">
        {keys.map((k) => {
          const D = LANDING_DESIGNS[k]
          const Report = REPORT_DESIGNS[k]
          return (
            <section key={k} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${data.approved === k ? 'border-emerald-500 ring-2 ring-emerald-500' : 'border-stone-200'}`}>
              {/* Scaled live preview of the real component */}
              <div className="grid grid-cols-2 border-b border-stone-200">
                {[
                  ['Landing', <D.Component key="l" cta={{ href: '#', label: 'Connect GitHub — it’s free' }} secondary={{ href: '#', label: 'How it works' }} />],
                  ['Report page', <Report key="r" data={SAMPLE_REPORT} />],
                ].map(([label, node], i) => (
                  <div key={i} className={`relative h-[300px] overflow-hidden bg-stone-900 ${i ? 'border-l border-stone-200' : ''}`}>
                    <div className="pointer-events-none absolute left-0 top-0 w-[1280px] origin-top-left" style={{ transform: 'scale(0.22)' }}>
                      {node}
                    </div>
                    <span className="absolute bottom-2 left-2 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-stone-800">{label}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-start justify-between gap-3 p-5">
                <div>
                  <h2 className="font-bold">{D.name}</h2>
                  <p className="mt-1 text-sm text-stone-600">{D.blurb}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 px-5 pb-5">
                <span className="flex gap-4 text-sm font-semibold">
                  <a href={`/design?preview=${k}`} className="underline underline-offset-4">
                    Landing
                  </a>
                  <a href={`/design?preview=${k}&page=report`} className="underline underline-offset-4">
                    Report page
                  </a>
                </span>
                <ApproveButton id={k} />
              </div>
            </section>
          )
        })}
      </main>
    </div>
  )
}
