import type { ComponentType } from 'react'
import { ReportEssay } from './ReportEssay'
import { ReportGuilloche } from './ReportGuilloche'
import { SAMPLE_REPORT, type ReportData } from './sample'

/** Signed-in report page in each landing style, keyed like LANDING_DESIGNS. */
export const REPORT_DESIGNS: Record<'essay' | 'guilloche', ComponentType<{ data: ReportData }>> = {
  essay: ReportEssay,
  guilloche: ReportGuilloche,
}
export { SAMPLE_REPORT }
export type { ReportData }
