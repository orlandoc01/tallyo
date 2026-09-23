import { describe, expect, it } from 'vitest'
import { accounts, categories, owners, tags } from '../../mocks/fixtures'
import { localDateRangeToUtcDateTimeRange } from '../../utils/dates'
import { activeFilterPills } from './transactionActiveFilters'
import { AMOUNT_PRESETS, amountMode, amountSummary, datePresetHint, datePresetRange, dateRangeSummary, selectedAmountPreset, selectedDatePreset, withAmountMode } from './transactionFilterPresets'

const now = new Date(2026, 8, 20, 12)
const lookups = { accounts, categories, owners, tags }

describe('date presets', () => {
  it('computes ranges from the clock', () => {
    expect(datePresetRange('THIS_MONTH', now)).toEqual(localDateRangeToUtcDateTimeRange('2026-09-01', '2026-09-30'))
    expect(datePresetRange('LAST_MONTH', now)).toEqual(localDateRangeToUtcDateTimeRange('2026-08-01', '2026-08-31'))
    expect(datePresetRange('LAST_30', now)).toEqual(localDateRangeToUtcDateTimeRange('2026-08-22', '2026-09-20'))
    expect(datePresetRange('LAST_90', now)).toEqual(localDateRangeToUtcDateTimeRange('2026-06-23', '2026-09-20'))
    expect(datePresetRange('YTD', now)).toEqual(localDateRangeToUtcDateTimeRange('2026-01-01', '2026-09-20'))
    expect(datePresetRange('ALL', now)).toBeUndefined()
    expect(datePresetHint('THIS_MONTH', now)).toBe('Sep 1 – Sep 30')
    expect(datePresetHint('ALL', now)).toBe('All')
  })

  it('recognises a preset range and summarises custom ranges', () => {
    expect(selectedDatePreset({ datetimeRange: datePresetRange('LAST_MONTH', now) }, now)).toBe('LAST_MONTH')
    expect(selectedDatePreset({}, now)).toBe('ALL')
    expect(dateRangeSummary({ datetimeRange: datePresetRange('YTD', now) }, now)).toBe('Year to date')
    expect(dateRangeSummary({ datetimeRange: localDateRangeToUtcDateTimeRange('2026-05-01', '2026-05-31') }, now)).toBe('May 1, 2026 – May 31, 2026')
    expect(dateRangeSummary({}, now)).toBeUndefined()
  })
})

describe('amount presets', () => {
  it('maps presets and modes onto filter fields', () => {
    expect(AMOUNT_PRESETS[0].apply({})).toMatchObject({ amountMax: 50 })
    expect(AMOUNT_PRESETS[1].apply({})).toMatchObject({ amountMin: 50, amountMax: 500 })
    expect(AMOUNT_PRESETS[2].apply({})).toMatchObject({ amountMin: 500 })
    expect(AMOUNT_PRESETS[3].apply({ amountMin: 10 })).toMatchObject({ amountMax: 0, amountMin: undefined })
    expect(selectedAmountPreset({ amountMin: 50, amountMax: 500 })).toBe('FROM_50_TO_500')
    expect(selectedAmountPreset({ amountMax: 0 })).toBe('INCOME')
    expect(selectedAmountPreset({ exactAmount: 5 })).toBeUndefined()

    expect(amountMode({})).toBe('both')
    expect(withAmountMode({ amountMax: 20 }, 'expenses')).toMatchObject({ excludeIncome: true, amountMax: 20 })
    expect(amountMode(withAmountMode({}, 'income'))).toBe('income')
    expect(withAmountMode({ amountMax: 0, excludeIncome: true }, 'both')).toMatchObject({ amountMax: undefined, excludeIncome: undefined })
    expect(amountSummary({ amountMin: 10, amountMax: 20, excludeIncome: true })).toBe('$10.00–$20.00 · Expenses')
    expect(amountSummary({ exactAmount: 62.3 })).toBe('= $62.30')
    expect(amountSummary({})).toBeUndefined()
  })
})

describe('activeFilterPills', () => {
  it('renders one pill per value and removal clears the right field', () => {
    const filter = { categoryIds: [categories[0].id, categories[1].id], ownerIds: [owners[1].id], untagged: true, merchantPrefix: 'Tar', isHidden: undefined }
    const pills = activeFilterPills(filter, lookups, now)

    expect(pills.map((pill) => `${pill.kind}:${pill.value}`)).toEqual([
      `Category:${categories[0].emoji} ${categories[0].name}`,
      `Category:${categories[1].emoji} ${categories[1].name}`,
      `Owner:${owners[1].name}`,
      'Tag:Untagged',
      'Merchant:Tar',
      'Hidden:Shown',
    ])
    expect(pills[0].remove(filter)).toMatchObject({ categoryIds: [categories[1].id] })
    expect(pills[2].remove(filter)).toMatchObject({ ownerIds: undefined })
    expect(pills[5].remove(filter)).toMatchObject({ isHidden: false })
    expect(activeFilterPills({ isHidden: false }, lookups, now)).toEqual([])
  })
})
