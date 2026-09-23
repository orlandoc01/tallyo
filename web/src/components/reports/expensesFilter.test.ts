import { describe, expect, it } from 'vitest'
import { localDateRangeToUtcDateTimeRange } from '../../utils/dates'
import { activeSpendingFilterCount, allTimeRange, spendingFilterFromTransactionsFilter, spendingFilterToTransactionsFilter, type SpendingFilterValues } from './expensesFilter'

const now = new Date(2026, 8, 20)
const values: SpendingFilterValues = { dateFrom: '2026-09-01', dateTo: '2026-09-30', categoryIds: ['1'], accountIds: [], ownerIds: ['alex'], showHidden: false }

describe('expenses filter mapping', () => {
  it('round-trips report params through a TransactionsFilter', () => {
    const filter = spendingFilterToTransactionsFilter(values, now)
    expect(filter).toEqual({ datetimeRange: localDateRangeToUtcDateTimeRange('2026-09-01', '2026-09-30'), isHidden: false, categoryIds: ['1'], accountIds: undefined, ownerIds: ['alex'] })
    expect(spendingFilterFromTransactionsFilter(filter, values, now)).toEqual(values)
  })

  it('maps an open date range to the all-time range and back', () => {
    const allTime = spendingFilterFromTransactionsFilter({ isHidden: undefined }, values, now)
    expect(allTime).toMatchObject({ ...allTimeRange(now), categoryIds: [], ownerIds: [], showHidden: true })
    expect(spendingFilterToTransactionsFilter(allTime, now).datetimeRange).toBeUndefined()
  })

  it('keeps the current bound when only one side of the range is set', () => {
    const next = spendingFilterFromTransactionsFilter({ datetimeRange: localDateRangeToUtcDateTimeRange('2026-09-05', undefined) }, values, now)
    expect(next).toMatchObject({ dateFrom: '2026-09-05', dateTo: '2026-09-30' })
  })

  it('counts active filters', () => {
    expect(activeSpendingFilterCount(values, false)).toBe(2)
    expect(activeSpendingFilterCount({ ...values, showHidden: true, accountIds: ['a', 'b'] }, true)).toBe(6)
  })
})
