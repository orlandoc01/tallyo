import { describe, expect, it } from 'vitest'
import { cashFlowPeriodsForFilter, spendingReportForFilter } from '../mocks/reportFixtures'

describe('stub report fixtures', () => {
  it('returns three monthly spending periods for the default monthly range', () => {
    const report = spendingReportForFilter({
      granularity: 'MONTHLY',
      isHidden: false,
      datetimeRange: { from: '2026-04-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
    })

    expect(report.periods.map((period) => period.periodLabel)).toEqual(['2026-04', '2026-05', '2026-06'])
  })

  it('returns three quarterly cash-flow periods for the default quarterly range', () => {
    const periods = cashFlowPeriodsForFilter({
      granularity: 'QUARTERLY',
      isHidden: false,
      datetimeRange: { from: '2025-10-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
    })

    expect(periods.map((period) => period.periodLabel)).toEqual(['2025 Q4', '2026 Q1', '2026 Q2'])
    expect(periods.every((period) => period.summary.income > 0)).toBe(true)
  })

  it('returns three yearly spending periods for the default yearly range', () => {
    const report = spendingReportForFilter({
      granularity: 'YEARLY',
      isHidden: false,
      datetimeRange: { from: '2024-01-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' },
    })

    expect(report.periods.map((period) => period.periodLabel)).toEqual(['2024', '2025', '2026'])
  })
})
