import type { ComponentType } from 'react'
import { DesignEssay } from './DesignEssay'
import { DesignGuilloche } from './DesignGuilloche'
import type { LandingProps } from './types'

export const LANDING_DESIGNS: Record<'essay' | 'guilloche', { name: string; blurb: string; Component: ComponentType<LandingProps> }> = {
  essay: { name: 'Essay', blurb: 'Text-centric. A short argument to engineering leaders, set as a long read with margin notes and highlighter.', Component: DesignEssay },
  guilloche: { name: 'Guilloche', blurb: 'Artistic. Banknote security engraving: guilloche rosettes and the hundred-eyed Argus, all computed in SVG.', Component: DesignGuilloche },
}
export const DEFAULT_DESIGN = 'essay' as const
export type DesignKey = keyof typeof LANDING_DESIGNS
export function isDesignKey(v: unknown): v is DesignKey {
  return typeof v === 'string' && v in LANDING_DESIGNS
}
export type { LandingProps }
