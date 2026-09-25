import { createContext, useContext } from 'react'

export type RiskSeverity = 'critical' | 'major' | 'minor' | 'info'

/** One open playbook finding attached to a clause. */
export interface RiskFinding {
  id: number
  severity: RiskSeverity
  issue: string
  suggestion: string
  quote: string
}

/** Per-clause risk summary: the worst severity, a count, and the findings. */
export interface RiskInfo {
  worst: RiskSeverity
  count: number
  findings: RiskFinding[]
}

/** Maps blockId → its open findings. Empty when no risks loaded. */
export type RiskMap = Record<number, RiskInfo>

export const RiskContext = createContext<RiskMap>({})

export const useRiskMap = () => useContext(RiskContext)
