import type { ComponentType } from 'react'
import { DesignLedger } from './DesignLedger'
import { DesignRedline } from './DesignRedline'
import { DesignSignal } from './DesignSignal'
import type { LandingProps } from './types'

export const LANDING_DESIGNS: Record<'signal' | 'ledger' | 'redline', { name: string; blurb: string; Component: ComponentType<LandingProps> }> = {
  signal: { name: 'A · Signal', blurb: 'Dark operator console. A live scan session where most candidates are disproven before they reach you.', Component: DesignSignal },
  ledger: { name: 'B · Ledger', blurb: 'Light, consultancy-style. A confidential CTO briefing: risk register with verified / needs-input / rejected stamps.', Component: DesignLedger },
  redline: { name: 'C · Redline', blurb: 'Offensive-security dossier: attack paths, PoC evidence, a brief for CTOs and team leads.', Component: DesignRedline },
}
export type { LandingProps }
