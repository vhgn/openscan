import { createFileRoute } from '@tanstack/react-router'
import { DesignEssay } from '#/components/landing/DesignEssay'
import { ReportEssay } from '#/components/report-designs/ReportEssay'
import { SAMPLE_REPORT } from '#/components/report-designs/sample'
import { Lede, Page, SectionHead, Squiggle, Title } from '#/components/ui'
import { getMe } from '#/server-fns/app'

type View = 'landing' | 'report'

export const Route = createFileRoute('/design')({
  validateSearch: (s: Record<string, unknown>): { view?: View } => (s.view === 'landing' || s.view === 'report' ? { view: s.view } : {}),
  loader: () => getMe(),
  head: () => ({ meta: [{ title: 'Design — openscan' }] }),
  component: DesignRecord,
})

const CTA = { href: '/api/auth/github/login', label: 'Connect GitHub — it’s free' }

/**
 * The design record. The owner chose "Essay" from the options shown here
 * (earlier rounds: Signal, Ledger, Redline, Console, Guilloche). It now shows the
 * chosen style: the landing page and a sample signed-in brief.
 */
function DesignRecord() {
  const { user } = Route.useLoaderData()
  const { view } = Route.useSearch()

  if (view) {
    return (
      <div className="relative">
        <div className="fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-3 border border-rule bg-paper/95 px-4 py-1.5 font-sans text-[13px] shadow-sm backdrop-blur">
          <a href="/design" className="link">
            ← Design
          </a>
          <span className="text-faint">|</span>
          <a href="/design?view=landing" className={view === 'landing' ? 'text-ink' : 'text-muted hover:text-ink'}>
            <Squiggle on={view === 'landing'}>Landing</Squiggle>
          </a>
          <a href="/design?view=report" className={view === 'report' ? 'text-ink' : 'text-muted hover:text-ink'}>
            <Squiggle on={view === 'report'}>Sample brief</Squiggle>
          </a>
        </div>
        {view === 'report' ? <ReportEssay data={SAMPLE_REPORT} /> : <DesignEssay cta={CTA} />}
      </div>
    )
  }

  return (
    <Page user={user} wide>
      <div className="max-w-[42rem]">
        <p className="label">Design</p>
        <Title>Essay: the brief is the product.</Title>
        <Lede>
          Chosen from six directions. Text is the interface: one reading column in Newsreader, Instrument Serif for display, notes in the margin, small sans labels, and a cream squiggle
          where something matters. The same system runs from the landing page to every signed-in page.
        </Lede>
      </div>
      <SectionHead>Pages</SectionHead>
      <div className="mt-6 grid gap-8 md:grid-cols-2">
        {(
          [
            ['landing', 'Landing page', <DesignEssay key="l" cta={CTA} />],
            ['report', 'Sample brief', <ReportEssay key="r" data={SAMPLE_REPORT} />],
          ] as const
        ).map(([k, label, node]) => (
          // Overlay link: the preview itself contains links, and anchors can't nest.
          <div key={k} className="group relative">
            <div className="relative h-[340px] overflow-hidden border border-rule" aria-hidden>
              <div className="pointer-events-none absolute left-0 top-0 w-[1280px] origin-top-left" style={{ transform: 'scale(0.36)' }}>
                {node}
              </div>
            </div>
            <a href={`/design?view=${k}`} className="mt-3 block text-[19px] after:absolute after:inset-0 group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
              {label} →
            </a>
          </div>
        ))}
      </div>
    </Page>
  )
}
