import { AREAS, type AreaId } from '#/lib/scanner/areas'

const LEVELS = ['critical', 'high', 'medium', 'low', 'info'] as const
export type Level = (typeof LEVELS)[number]

export interface FindingFilterState {
  level?: Level
  area?: AreaId
}

interface Filterable {
  severity: string
  areas: AreaId[]
}

export function applyFindingFilters<T extends Filterable>(items: T[], f: FindingFilterState): T[] {
  return items.filter((x) => (!f.level || x.severity === f.level) && (!f.area || x.areas.includes(f.area)))
}

export function isLevel(v: unknown): v is Level {
  return typeof v === 'string' && (LEVELS as readonly string[]).includes(v)
}
export function isArea(v: unknown): v is AreaId {
  return typeof v === 'string' && AREAS.some((a) => a.id === v)
}

/**
 * Two rows of filter chips above a findings list: by level and by area. Only values
 * that occur are offered, each with a small count; clicking the selected one again
 * (or "All") clears that filter. The other filter is taken into account in counts.
 */
export function FindingFilters<T extends Filterable>({ items, value, onChange }: { items: T[]; value: FindingFilterState; onChange: (v: FindingFilterState) => void }) {
  const byArea = applyFindingFilters(items, { area: value.area })
  const byLevel = applyFindingFilters(items, { level: value.level })
  const levels = LEVELS.map((l) => ({ id: l, label: l[0].toUpperCase() + l.slice(1), n: byArea.filter((x) => x.severity === l).length })).filter((l) => l.n > 0 || l.id === value.level)
  const areas = AREAS.map((a) => ({ id: a.id, label: a.label, n: byLevel.filter((x) => x.areas.includes(a.id)).length })).filter((a) => a.n > 0 || a.id === value.area)
  if (items.length < 2 && !value.level && !value.area) return null

  const chip = (on: boolean) =>
    `inline-flex items-baseline gap-1.5 px-2.5 py-1 font-sans text-[12.5px] transition-colors ${
      on ? 'bg-ink text-paper' : 'text-ink-3 shadow-[inset_0_0_0_1px_rgb(20_20_20/0.18)] hover:text-ink hover:shadow-[inset_0_0_0_1px_rgb(20_20_20/0.45)]'
    }`
  const count = (on: boolean) => `text-[10.5px] tabular-nums ${on ? 'text-paper/55' : 'text-faint'}`

  // A render function, not a component, so the buttons keep their identity across renders.
  const row = <K extends 'level' | 'area'>(name: K, title: string, options: Array<{ id: NonNullable<FindingFilterState[K]>; label: string; n: number }>) => (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5" role="group" aria-label={`Filter by ${title.toLowerCase()}`}>
      <span className="label w-14 shrink-0">{title}</span>
      <button type="button" aria-pressed={!value[name]} onClick={() => onChange({ ...value, [name]: undefined })} className={chip(!value[name])}>
        All
      </button>
      {options.map((o) => {
        const on = value[name] === o.id
        return (
          <button key={o.id} type="button" aria-pressed={on} onClick={() => onChange({ ...value, [name]: on ? undefined : o.id })} className={chip(on)}>
            {o.label}
            <span className={count(on)} aria-label={`${o.n} findings`}>
              {o.n}
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="mt-5 space-y-2.5">
      {row('level', 'Level', levels)}
      {areas.length > 0 && row('area', 'Area', areas)}
    </div>
  )
}
