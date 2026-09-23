import { describe, expect, it } from 'vitest'
import { recurringCharges } from '../../mocks/fixtures'
import type { RecurringCharge } from '../../types/graphql'
import { groupByCadence, latestTransaction, monthlyAmount, recurringStats } from './recurringCadence'

function charge(fields: Partial<RecurringCharge>): RecurringCharge {
  return { ...recurringCharges[0], transactions: [], ...fields }
}

describe('recurringCadence', () => {
  it('labels every interval and puts unknown intervals last as Irregular', () => {
    const labels = groupByCadence(['YEARLY', null, 'QUARTERLY', 'MONTHLY', 'BIWEEKLY', 'WEEKLY'].map((interval, index) => charge({ id: String(index), interval: interval as RecurringCharge['interval'] }))).map((group) => group.label)
    expect(labels).toEqual(['Weekly', 'Biweekly', 'Monthly', 'Quarterly', 'Yearly', 'Irregular'])
  })

  it('normalises amounts per month', () => {
    expect(monthlyAmount(12, 'WEEKLY')).toBeCloseTo(52)
    expect(monthlyAmount(12, 'BIWEEKLY')).toBeCloseTo(26)
    expect(monthlyAmount(12, 'MONTHLY')).toBe(12)
    expect(monthlyAmount(12, 'QUARTERLY')).toBe(4)
    expect(monthlyAmount(12, 'YEARLY')).toBe(1)
    expect(monthlyAmount(12, null)).toBe(0)
  })

  it('groups by cadence in fixed order, sorted by last seen, with cycle totals', () => {
    const groups = groupByCadence([
      charge({ id: 'a', interval: null, estimatedAmount: 5, lastDate: '2026-01-01' }),
      charge({ id: 'b', interval: 'MONTHLY', estimatedAmount: 10, lastDate: '2026-02-01' }),
      charge({ id: 'c', interval: 'WEEKLY', estimatedAmount: -3, lastDate: '2026-03-01' }),
      charge({ id: 'd', interval: 'MONTHLY', estimatedAmount: 20, lastDate: '2026-04-01' }),
    ])
    expect(groups.map((group) => group.label)).toEqual(['Weekly', 'Monthly', 'Irregular'])
    expect(groups[1].items.map((item) => item.id)).toEqual(['d', 'b'])
    expect(groups[1].cycleTotal).toBe(30)
    expect(groups[0].cycleTotal).toBe(-3)
    expect(groupByCadence([
      charge({ id: 'e', interval: 'MONTHLY', estimatedAmount: 40 }),
      charge({ id: 'f', interval: 'MONTHLY', estimatedAmount: -100 }),
    ])[0].cycleTotal).toBe(-60)
  })

  it('computes monthly expenses, income and the next-7-days window', () => {
    const now = new Date(2026, 8, 20, 12)
    const stats = recurringStats([
      charge({ interval: 'MONTHLY', estimatedAmount: 100, nextExpectedDate: '2026-09-20' }),
      charge({ interval: 'BIWEEKLY', estimatedAmount: -1200, nextExpectedDate: '2026-09-27' }),
      charge({ interval: 'YEARLY', estimatedAmount: 120, nextExpectedDate: '2026-09-28' }),
      charge({ interval: 'QUARTERLY', estimatedAmount: 30, nextExpectedDate: '2026-09-19' }),
      charge({ interval: null, estimatedAmount: 30, nextExpectedDate: null }),
    ], now)
    expect(stats.monthlyExpenses).toBeCloseTo(100 + 10 + 10)
    expect(stats.monthlyIncome).toBeCloseTo(2600)
    expect(stats.next7Total).toBe(1300)
    expect(stats.next7Count).toBe(2)
  })

  it('picks the most recent transaction', () => {
    expect(latestTransaction([{ datetime: '2026-01-01T00:00:00Z' }, { datetime: '2026-03-01T00:00:00Z' }, { datetime: '2026-02-01T00:00:00Z' }])?.datetime).toBe('2026-03-01T00:00:00Z')
    expect(latestTransaction([])).toBeUndefined()
  })
})
