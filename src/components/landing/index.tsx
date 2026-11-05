import type { ComponentType } from 'react'
import { DesignEssay } from './DesignEssay'
import { DesignGuilloche } from './DesignGuilloche'
import type { LandingProps } from './types'

export const LANDING_DESIGNS: Record<'essay' | 'guilloche', { name: string; blurb: string; Component: ComponentType<LandingProps> }> = {
  essay: { name: 'Essay', blurb: 'Text-centric. The pitch is a short argument to engineering leaders; the report reads as a typeset weekly brief with margin notes and cream squiggle underlines.', Component: DesignEssay },
  guilloche: { name: 'Guilloche', blurb: 'Artistic. Banknote security printing: guilloche rosettes, a dithered marble Apollo, serif display type; the report becomes a certificate of review.', Component: DesignGuilloche },
}
export const DEFAULT_DESIGN = 'essay' as const
export type DesignKey = keyof typeof LANDING_DESIGNS
export function isDesignKey(v: unknown): v is DesignKey {
  return typeof v === 'string' && v in LANDING_DESIGNS
}
export type { LandingProps }
