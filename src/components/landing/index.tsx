import type { ComponentType } from 'react'
import { DesignConsole } from './DesignConsole'
import { DesignEssay } from './DesignEssay'
import { DesignGuilloche } from './DesignGuilloche'
import type { LandingProps } from './types'

export const LANDING_DESIGNS: Record<'console' | 'essay' | 'guilloche', { name: string; blurb: string; Component: ComponentType<LandingProps> }> = {
  console: { name: 'A · Console', blurb: 'Terminal. The page is a full-screen amber-phosphor TUI: box-drawn panes, a findings list, a function-key bar.', Component: DesignConsole },
  essay: { name: 'B · Essay', blurb: 'Text-centric. A short argument to engineering leaders, set as a long read with margin notes and highlighter.', Component: DesignEssay },
  guilloche: { name: 'C · Guilloche', blurb: 'Artistic. Banknote security engraving: guilloche rosettes and the hundred-eyed Argus, all computed in SVG.', Component: DesignGuilloche },
}
export const DEFAULT_DESIGN = 'console' as const
export type DesignKey = keyof typeof LANDING_DESIGNS
export function isDesignKey(v: unknown): v is DesignKey {
  return typeof v === 'string' && v in LANDING_DESIGNS
}
export type { LandingProps }
