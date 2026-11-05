import { AREAS, type AreaId } from '#/lib/scanner/areas'
import { Squiggle } from './ui'

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
 * Two lines of filters above a findings list: by level and by area. Only values
 * that occur are offered, each with its count; clicking the selected one again
 * (or "All") clears that filter. The other filter is taken into account in counts.
 */
export function FindingFilters<T extends Filterable>({ items, value, onChange }: { items: T[]; value: FindingFilterState; onChange: (v: FindingFilterState) => void }) {
  const byArea = applyFindingFilters(items, { area: value.area })
  const byLevel = applyFindingFilters(items, { level: value.level })
  const levels = LEVELS.map((l) => ({ id: l, label: l[0].toUpperCase() + l.slice(1), n: byArea.filter((x) => x.severity === l).length })).filter((l) => l.n > 0 || l.id === value.level)
  const areas = AREAS.map((a) => ({ id: a.id, label: a.label, n: byLevel.filter((x) => x.areas.includes(a.id)).length })).filter((a) => a.n > 0 || a.id === value.area)
  if (items.length < 2 && !value.level && !value.area) return null

  // A render function, not a component, so the buttons keep their identity and the squiggle animates.
  const row = <K extends 'level' | 'area'>(name: K, title: string, options: Array<{ id: NonNullable<FindingFilterState[K]>; label: string; n: number }>) => (
    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 font-sans text-[13px]" role="group" aria-label={`Filter by ${title.toLowerCase()}`}>
      <span className="label w-14 shrink-0">{title}</span>
      <button type="button" aria-pressed={!value[name]} onClick={() => onChange({ ...value, [name]: undefined })} className={!value[name] ? 'text-ink' : 'text-muted hover:text-ink'}>
        <Squiggle on={!value[name]}>All</Squiggle>
      </button>
      {options.map((o) => {
        const on = value[name] === o.id
        return (
          <button key={o.id} type="button" aria-pressed={on} onClick={() => onChange({ ...value, [name]: on ? undefined : o.id })} className={on ? 'text-ink' : 'text-muted hover:text-ink'}>
            <Squiggle on={on}>{o.label}</Squiggle> <span className="text-faint">{o.n}</span>
          </button>
        )
      })}
    </p>
  )

  return (
    <div className="mt-5 space-y-2">
      {row('level', 'Level', levels)}
      {areas.length > 0 && row('area', 'Area', areas)}
    </div>
  )
}
