import type { ComponentType } from 'react'
import { DesignLedger } from './DesignLedger'
import { DesignRedline } from './DesignRedline'
import { DesignSignal } from './DesignSignal'
import type { LandingProps } from './types'

export const LANDING_DESIGNS: Record<'signal' | 'ledger' | 'redline', { name: string; blurb: string; Component: ComponentType<LandingProps> }> = {
  signal: { name: 'A · Signal', blurb: 'Dark, developer-native. Leads with the actual triage output.', Component: DesignSignal },
  ledger: { name: 'B · Ledger', blurb: 'Light, editorial. Positions the report as a briefing for leadership.', Component: DesignLedger },
  redline: { name: 'C · Redline', blurb: 'Offensive-security dossier: attack paths, PoC evidence, a brief for CTOs and team leads.', Component: DesignRedline },
}
export type { LandingProps }
