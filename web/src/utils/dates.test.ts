import { describe, expect, it } from 'vitest'
import {
  formatDisplayDate,
  formatCompactDisplayDate,
  formatRelativeTime,
  formatTransactionDatetime,
  getCurrentPeriod,
  getLastThreePeriodDateRange,
  localDateKeyFromDatetime,
  localDateRangeFromDateTimeRange,
  localDateRangeToUtcDateTimeRange,
  parseLocalDate,
  toDateInputValue,
} from './dates'

describe('date utilities', () => {
  it('parses schema dates as local dates', () => {
    const date = parseLocalDate('2026-05-14')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(4)
    expect(date.getDate()).toBe(14)
  })

  it('creates monthly periods', () => {
    const period = getCurrentPeriod('MONTHLY', new Date(2026, 4, 14))
    expect(toDateInputValue(period.start)).toBe('2026-05-01')
    expect(toDateInputValue(period.end)).toBe('2026-05-31')
    expect(period.label).toBe('May 2026')
  })

  it('creates last-three monthly date ranges including the current month', () => {
    expect(getLastThreePeriodDateRange('MONTHLY', new Date(2026, 0, 4))).toEqual({
      dateFrom: '2025-11-01',
      dateTo: '2026-01-31',
    })
  })

  it('creates last-three quarterly date ranges including the current quarter', () => {
    expect(getLastThreePeriodDateRange('QUARTERLY', new Date(2026, 0, 4))).toEqual({
      dateFrom: '2025-07-01',
      dateTo: '2026-03-31',
    })
  })

  it('creates last-three yearly date ranges including the current year', () => {
    expect(getLastThreePeriodDateRange('YEARLY', new Date(2026, 0, 4))).toEqual({
      dateFrom: '2024-01-01',
      dateTo: '2026-12-31',
    })
  })

  it('formats dates for display', () => {
    expect(formatDisplayDate('2026-05-14')).toBe('May 14, 2026')
  })

  it('formats compact dates for date range pills', () => {
    expect(formatCompactDisplayDate('2026-05-14')).toBe('05-14-26')
  })

  it('formats relative sync recency', () => {
    const now = new Date('2026-05-14T12:03:00Z').getTime()

    expect(formatRelativeTime('2026-05-14T12:00:00Z', now)).toBe('3m ago')
    expect(formatRelativeTime('2026-05-13T12:03:00Z', now)).toBe('1d ago')
  })

  it('formats UTC datetimes using the browser local date', () => {
    expect(localDateKeyFromDatetime('2026-05-14T12:00:00Z')).toMatch(/^2026-05-1[45]$/)
  })

  it('formats transaction date-only sentinels as ISO dates', () => {
    expect(formatTransactionDatetime('2026-05-28T12:00:00Z')).toBe('2026-05-28')
  })

  it('formats transaction timestamps as ISO date and compact local time', () => {
    const localFivePm = new Date(2026, 4, 26, 17).toISOString()

    expect(formatTransactionDatetime(localFivePm)).toBe('2026-05-26 5:00PM')
  })

  it('converts local date filters to UTC datetime ranges for server queries', () => {
    const range = localDateRangeToUtcDateTimeRange('2026-05-14', '2026-05-14')

    expect(range?.from).toBe(new Date(2026, 4, 14).toISOString())
    expect(range?.to).toBe(new Date(2026, 4, 15).toISOString())
  })

  it('converts UTC datetime ranges back to local date inputs', () => {
    const range = localDateRangeToUtcDateTimeRange('2026-05-14', '2026-05-14')

    expect(localDateRangeFromDateTimeRange(range)).toEqual({ dateFrom: '2026-05-14', dateTo: '2026-05-14' })
  })
})
