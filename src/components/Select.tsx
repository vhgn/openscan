import { useEffect, useId, useRef, useState } from 'react'
import { Squiggle } from './ui'

export interface SelectOption<T extends string | number> {
  value: T
  label: string
  hint?: string
}

/**
 * Dropdown in the Essay style, replacing the native <select>: an inline ruled
 * trigger and a paper popover whose selected option carries the squiggle.
 * Keyboard: Enter/Space/↓ open; ↑/↓/Home/End move; Enter selects; Esc closes;
 * typing a letter jumps to the next option starting with it.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className = '',
  size = 'serif',
}: {
  value: T
  options: Array<SelectOption<T>>
  onChange: (v: T) => void
  label: string
  className?: string
  /** "serif" sits inside a sentence; "sans" matches small controls. */
  size?: 'serif' | 'sans'
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)))
  const root = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLSpanElement>(null)
  const current = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const pick = (i: number) => {
    onChange(options[i].value)
    setOpen(false)
    button.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault()
        openList()
      }
      return
    }
    if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(options.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setActive(e.key === 'Home' ? 0 : options.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(active)
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const k = e.key.toLowerCase()
      const n = options.length
      for (let step = 1; step <= n; step++) {
        const i = (active + step) % n
        if (options[i].label.toLowerCase().startsWith(k)) {
          setActive(i)
          break
        }
      }
    }
  }

  const text = size === 'serif' ? 'font-serif text-[inherit]' : 'font-sans text-[14px]'
  return (
    <span ref={root} className={`relative inline-block align-baseline ${className}`}>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${label}: ${current?.label ?? ''}`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={`inline-flex max-w-full items-baseline gap-1.5 border-b border-ink/40 pb-0.5 text-left ${text} hover:border-ink focus-visible:border-ink focus-visible:outline-none`}
      >
        <span className="truncate">{current?.label}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden className={`shrink-0 self-center text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        // Spans, not ul/li: the select often sits inside a sentence's <p>.
        <span
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className="absolute left-0 top-[calc(100%+0.4rem)] z-30 block max-h-72 min-w-full overflow-y-auto border border-rule bg-paper py-1.5 shadow-[0_10px_30px_-12px_rgb(20_20_20/0.25)] animate-[fade-in_0.15s_ease-out]"
        >
          {options.map((o, i) => {
            const selected = o.value === value
            return (
              <span
                key={String(o.value)}
                id={`${id}-${i}`}
                data-index={i}
                role="option"
                aria-selected={selected}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(i)}
                className={`block cursor-pointer whitespace-nowrap px-4 py-1.5 ${size === 'serif' ? 'font-serif text-[17px]' : 'font-sans text-[14px]'} ${i === active ? 'bg-wash' : ''} ${selected ? 'text-ink' : 'text-ink-3'}`}
              >
                <Squiggle on={selected}>{o.label}</Squiggle>
                {o.hint && <span className="ml-2 font-sans text-[12px] text-muted">{o.hint}</span>}
              </span>
            )
          })}
        </span>
      )}
    </span>
  )
}
