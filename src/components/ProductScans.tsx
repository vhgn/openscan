import { Link } from '@tanstack/react-router'
import { Empty, Severity, StatusMark, timeAgo } from '#/components/ui'
import type { ProductScanItem } from '#/lib/queries'

const TRIGGER: Record<string, string> = { manual: 'on request', schedule: 'scheduled', push: 'on push', onboarding: 'first review' }

export const isLive = (s: { status: string }) => s.status === 'queued' || s.status === 'running'

/** Product scans, each with the repository scans it owns. */
export function ProductScans({ items, showProduct = true, empty = 'No reviews yet.' }: { items: ProductScanItem[]; showProduct?: boolean; empty?: string }) {
  return (
    <ol className="mt-4">
      {items.length === 0 && <Empty>{empty}</Empty>}
      {items.map((ps) => {
        const only = ps.scans.length === 1 ? ps.scans[0] : null
        const title = only?.headline ?? `Review of ${showProduct ? ps.product : `${ps.scans.length} repositories`}`
        const titleClass = 'text-[17px] hover:underline hover:decoration-1 hover:underline-offset-4'
        return (
          <li key={ps.id} className="grid gap-1 border-t border-rule py-3 first:border-t-0 sm:grid-cols-[6.5rem_1fr_auto] sm:items-baseline sm:gap-4">
            <span className="flex items-center gap-2 font-sans text-[12.5px] text-muted">
              <StatusMark status={ps.status} />
              {isLive(ps) ? `${ps.progress}%` : timeAgo(ps.finished_at ?? ps.created_at)}
            </span>
            <span className="min-w-0">
              {only ? (
                <Link to="/scans/$scanId" params={{ scanId: only.id }} className={titleClass}>
                  {title}
                </Link>
              ) : showProduct ? (
                <Link to="/products/$productId" params={{ productId: ps.product_id }} className={titleClass}>
                  {title}
                </Link>
              ) : (
                <span className="text-[17px]">{title}</span>
              )}
              <span className="block font-sans text-[12.5px] leading-relaxed text-muted">
                {showProduct && only && `${ps.product} · `}
                {TRIGGER[ps.trigger] ?? ps.trigger}
                {ps.push?.commit_sha && <span className="font-mono"> @{ps.push.commit_sha.slice(0, 7)}</span>}
                {ps.status === 'failed' && ' · failed'}
                {ps.scans.map((s) => (
                  <span key={s.id}>
                    {' · '}
                    <Link to="/scans/$scanId" params={{ scanId: s.id }} className="link text-ink-3">
                      {s.repo}
                    </Link>
                    {isLive(s) ? ` ${s.progress}%` : s.status === 'failed' ? ' (failed)' : s.findings ? ` (${s.findings})` : ''}
                  </span>
                ))}
              </span>
            </span>
            {ps.risk ? <Severity severity={ps.risk} /> : <span />}
          </li>
        )
      })}
    </ol>
  )
}
