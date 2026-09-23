import { describe, expect, it } from 'vitest'
import { cashFlowPeriods } from '../../mocks/fixtures'
import type { CashFlowPeriod } from '../../types/graphql'
import { averageSavingsRate, buildCashFlowSeries, cashFlowDatePresets, cashFlowPresetHint, cashFlowRangeSummary, deltaText, deltaTone, granularityUnit, isDefaultCashFlowRange, periodDelta, periodSpanLabel, savingsRatePct, selectedCashFlowPreset, shortPeriodLabel, type CashFlowDatePresetId } from './cashFlowStats'

const now = new Date(2026, 8, 18)
const presets = cashFlowDatePresets()
const range = (id: CashFlowDatePresetId, firstDate?: string) => cashFlowDatePresets(firstDate).find((preset) => preset.id === id)!.range(now)

describe('cash flow date presets', () => {
  it('builds month-aligned preset ranges', () => {
    expect(range('LAST_3_MONTHS')).toEqual({ dateFrom: '2026-07-01', dateTo: '2026-09-30' })
    expect(range('LAST_6_MONTHS')).toEqual({ dateFrom: '2026-04-01', dateTo: '2026-09-30' })
    expect(range('YTD')).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-09-30' })
    expect(range('LAST_12_MONTHS')).toEqual({ dateFrom: '2025-10-01', dateTo: '2026-09-30' })
    expect(range('ALL', '2024-02-15')).toEqual({ dateFrom: '2024-02-15', dateTo: '2026-09-30' })
    expect(range('ALL')).toEqual({ dateFrom: '2000-01-01', dateTo: '2026-09-30' })
    expect(cashFlowPresetHint(presets[0], now)).toBe('Jul 1 – Sep 30')
    expect(cashFlowPresetHint(presets[4], now)).toBeUndefined()
  })

  it('recognises a preset range and summarises custom ranges', () => {
    expect(selectedCashFlowPreset(presets, { dateFrom: '2026-01-01', dateTo: '2026-09-30' }, now)?.id).toBe('YTD')
    expect(selectedCashFlowPreset(presets, { dateFrom: '2026-01-02', dateTo: '2026-09-30' }, now)).toBeUndefined()
    expect(cashFlowRangeSummary(presets, { dateFrom: '2026-04-01', dateTo: '2026-09-30' }, now)).toBe('Last 6 months')
    expect(cashFlowRangeSummary(presets, { dateFrom: '2026-03-20', dateTo: '2026-09-18' }, now)).toBe('Mar 20, 2026 – Sep 18, 2026')
  })

  it('treats the last-three-periods range as the default per granularity', () => {
    expect(isDefaultCashFlowRange({ dateFrom: '2026-07-01', dateTo: '2026-09-30' }, 'MONTHLY', now)).toBe(true)
    expect(isDefaultCashFlowRange({ dateFrom: '2026-07-01', dateTo: '2026-09-30' }, 'QUARTERLY', now)).toBe(false)
    expect(isDefaultCashFlowRange({ dateFrom: '2026-01-01', dateTo: '2026-09-30' }, 'QUARTERLY', now)).toBe(true)
  })
})

describe('cash flow labels and stats', () => {
  it('shortens period labels per granularity', () => {
    expect(shortPeriodLabel('2026-08')).toBe('Aug')
    expect(shortPeriodLabel('2026-Q2')).toBe("Q2 '26")
    expect(shortPeriodLabel('2026 Q2')).toBe("Q2 '26")
    expect(shortPeriodLabel('2025')).toBe('2025')
    expect(granularityUnit('MONTHLY')).toBe('mo')
    expect(granularityUnit('QUARTERLY')).toBe('qtr')
    expect(granularityUnit('YEARLY')).toBe('yr')
  })

  it('computes savings rates and their average over buckets with income', () => {
    expect(savingsRatePct({ income: 9831.79, expenses: 14749.07 })).toBe(-50)
    expect(savingsRatePct({ income: 0, expenses: 10 })).toBe(0)
    expect(averageSavingsRate(cashFlowPeriods)).toEqual({ pct: 93, count: 3 })
    const noIncome = { ...cashFlowPeriods[0], summary: { ...cashFlowPeriods[0].summary, income: 0 } }
    expect(averageSavingsRate([noIncome, ...cashFlowPeriods])).toEqual({ pct: 93, count: 3 })
    expect(averageSavingsRate([noIncome])).toEqual({ pct: 0, count: 0 })
  })

  it('caps the bucket span at today', () => {
    expect(periodSpanLabel({ periodStart: '2026-09-01', periodEnd: '2026-09-30' }, now)).toBe('Sep 1 – Sep 18')
    expect(periodSpanLabel({ periodStart: '2026-08-01', periodEnd: '2026-08-31' }, now)).toBe('Aug 1 – Aug 31')
  })

  it('describes the change against the previous bucket', () => {
    expect(periodDelta(cashFlowPeriods, 0, (period) => period.summary.income)).toBeNull()
    const delta = periodDelta(cashFlowPeriods, 1, (period) => period.summary.income)!
    expect(delta).toEqual({ changeUSD: -200, previousLabel: 'Apr' })
    expect(deltaText(delta)).toBe('▼ $200 vs Apr')
    expect(deltaText({ changeUSD: 16300, previousLabel: 'Aug' })).toBe('▲ $16.3K vs Aug')
    expect(deltaText({ changeUSD: 0, previousLabel: 'Aug' })).toBe('$0 vs Aug')
    expect(deltaTone(-1)).toBe('text-negative')
    expect(deltaTone(-1, true)).toBe('text-positive')
    expect(deltaTone(0)).toBe('text-text-muted')
  })
})

describe('buildCashFlowSeries', () => {
  it('splits each bucket into the largest category across the range and the rest', () => {
    const periods: CashFlowPeriod[] = cashFlowPeriods.map((period, index) => ({
      ...period,
      summary: { ...period.summary, income: period.summary.income + 500 },
      incomeByCategory: index === 0 ? period.incomeByCategory : [...period.incomeByCategory, { category: { ...period.incomeByCategory[0].category, id: 'side', name: 'Side gig' }, total: 500, transactionCount: 1, percentOfTotal: 10 }],
    }))

    const series = buildCashFlowSeries(periods)

    expect(series.incomeLabel).toBe(cashFlowPeriods[0].incomeByCategory[0].category.name)
    expect(series.expenseLabel).toBe('Restaurants & Bars')
    expect(series.bars.map((bar) => bar.label)).toEqual(['Apr', 'May', 'Jun'])
    expect(series.bars[1].income).toEqual({ primary: 3000, secondary: 500 })
    expect(series.bars[1].expenses.primary).toBe(150)
    expect(series.bars[1].expenses.secondary).toBeCloseTo(62.3)
    expect(series.bars[1].net).toBeCloseTo(3500 - 212.3)
  })

  it('clamps the primary shade to the bucket total', () => {
    const period = { ...cashFlowPeriods[0], summary: { ...cashFlowPeriods[0].summary, income: 1000 } }
    expect(buildCashFlowSeries([period]).bars[0].income).toEqual({ primary: 1000, secondary: 0 })
  })

  it('falls back to generic labels and single-shade bars without category data', () => {
    const series = buildCashFlowSeries([{ ...cashFlowPeriods[0], incomeByCategory: [], expensesByCategory: [] }])

    expect(series.incomeLabel).toBe('Income')
    expect(series.expenseLabel).toBe('Expenses')
    expect(series.bars[0].income).toEqual({ primary: 0, secondary: 3200 })
  })
})
