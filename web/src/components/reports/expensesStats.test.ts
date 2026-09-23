import { describe, expect, it } from 'vitest'
import { dailyAverage, elapsedDays, previousRange, spendingDelta } from './expensesStats'

describe('expenses stats', () => {
  it('steps whole calendar months back by the same number of months', () => {
    expect(previousRange({ dateFrom: '2026-09-01', dateTo: '2026-09-30' })).toEqual({ dateFrom: '2026-08-01', dateTo: '2026-08-31', label: 'vs last month' })
    expect(previousRange({ dateFrom: '2026-07-01', dateTo: '2026-09-30' })).toEqual({ dateFrom: '2026-04-01', dateTo: '2026-06-30', label: 'vs prior 3 months' })
  })

  it('clamps to the shorter previous month', () => {
    expect(previousRange({ dateFrom: '2026-03-01', dateTo: '2026-03-31' })).toMatchObject({ dateFrom: '2026-02-01', dateTo: '2026-02-28' })
    expect(previousRange({ dateFrom: '2026-05-01', dateTo: '2026-05-31' })).toMatchObject({ dateFrom: '2026-04-01', dateTo: '2026-04-30' })
  })

  it('steps arbitrary spans back by their own length', () => {
    expect(previousRange({ dateFrom: '2026-09-10', dateTo: '2026-09-19' })).toEqual({ dateFrom: '2026-08-31', dateTo: '2026-09-09', label: 'vs prior 10 days' })
  })

  it('counts elapsed days up to today and clamps to the range', () => {
    const range = { dateFrom: '2026-09-01', dateTo: '2026-09-30' }
    expect(elapsedDays(range, new Date(2026, 8, 18))).toEqual({ elapsed: 18, total: 30 })
    expect(elapsedDays(range, new Date(2026, 10, 1))).toEqual({ elapsed: 30, total: 30 })
    expect(elapsedDays(range, new Date(2026, 7, 1))).toEqual({ elapsed: 0, total: 30 })
  })

  it('averages over elapsed days and derives the delta against the previous total', () => {
    expect(dailyAverage(900, 18)).toBe(50)
    expect(dailyAverage(900, 0)).toBe(0)
    expect(spendingDelta(1100, 1000)).toEqual({ changeUSD: 100, changePct: 10 })
    expect(spendingDelta(1100, 0)).toBeNull()
    expect(spendingDelta(1100, null)).toBeNull()
  })
})
