import {
  addDays,
  addMonths,
  addQuarters,
  addYears,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  format,
  startOfMonth,
  startOfQuarter,
  startOfYear,
} from 'date-fns'
import type { DateTimeRange, Granularity } from '../types/graphql'

interface PeriodRange {
  granularity: Granularity
  start: Date
  end: Date
  label: string
}

export function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function toDateInputValue(date: Date) {
  return format(date, 'yyyy-MM-dd')
}

export function formatDisplayDate(value: string) {
  return format(parseLocalDate(value), 'MMM d, yyyy')
}

export function formatCompactDisplayDate(value: string) {
  return format(parseLocalDate(value), 'MM-dd-yy')
}

export function localDateKeyFromDatetime(value: string): string {
  return toDateInputValue(parseDatetime(value))
}

export function formatDatetimeAsLocalDate(value: string): string {
  return formatDisplayDate(localDateKeyFromDatetime(value))
}

export function localDateRangeToUtcDateTimeRange(dateFrom?: string, dateTo?: string): DateTimeRange | undefined {
  const from = dateFrom ? startOfLocalDay(parseLocalDate(dateFrom)).toISOString() : undefined
  const to = dateTo ? startOfLocalDay(addDays(parseLocalDate(dateTo), 1)).toISOString() : undefined

  return from || to ? { from, to } : undefined
}

export function localDateRangeFromDateTimeRange(range?: DateTimeRange) {
  return {
    dateFrom: range?.from ? toDateInputValue(parseDatetime(range.from)) : undefined,
    dateTo: range?.to ? toDateInputValue(new Date(parseDatetime(range.to).getTime() - 1)) : undefined,
  }
}

/** Parse an ISO 8601 datetime string (YYYY-MM-DDTHH:mm:ssZ) to a Date object. */
function parseDatetime(value: string): Date {
  return new Date(value)
}

/** Format an ISO 8601 datetime for list views — shows just the date portion. */
function formatDatetimeAsDate(value: string): string {
  return format(parseDatetime(value), 'yyyy-MM-dd')
}

/** Format an ISO 8601 datetime for detail views — shows full date and time. */
function formatDatetimeFull(value: string): string {
  return format(parseDatetime(value), 'yyyy-MM-dd h:mma')
}

/**
 * Format a transaction datetime for display. When the backend synthesized a
 * noon-UTC sentinel (T12:00:00Z) because Plaid only provided a date, show just
 * the date — the time component carries no real information. For exact timestamps
 * from Plaid, show the full date and local time.
 */
export function formatTransactionDatetime(value: string): string {
  return value.endsWith('T12:00:00Z') ? formatDatetimeAsDate(value) : formatDatetimeFull(value)
}

export function getCurrentPeriod(granularity: Granularity = 'MONTHLY', anchor = new Date()): PeriodRange {
  return makePeriod(granularity, anchor)
}

export function getLastThreePeriodDateRange(granularity: Granularity = 'MONTHLY', anchor = new Date()) {
  const startAnchor =
    granularity === 'MONTHLY'
      ? addMonths(anchor, -2)
      : granularity === 'QUARTERLY'
        ? addQuarters(anchor, -2)
        : addYears(anchor, -2)
  const startPeriod = makePeriod(granularity, startAnchor)
  const endPeriod = makePeriod(granularity, anchor)

  return {
    dateFrom: toDateInputValue(startPeriod.start),
    dateTo: toDateInputValue(endPeriod.end),
  }
}

export function currentBudgetPath(anchor = new Date()) {
  return `/budgets/${format(anchor, 'yyyy-MM')}`
}

export function periodFromMonthKey(monthKey: string): PeriodRange | null {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return null
  const [year, month] = monthKey.split('-').map(Number)
  if (month < 1 || month > 12) return null
  return makePeriod('MONTHLY', new Date(year, month - 1, 1))
}

export function shiftPeriod(period: PeriodRange, direction: -1 | 1): PeriodRange {
  const nextAnchor =
    period.granularity === 'MONTHLY'
      ? addMonths(period.start, direction)
      : period.granularity === 'QUARTERLY'
        ? addQuarters(period.start, direction)
        : addYears(period.start, direction)

  return makePeriod(period.granularity, nextAnchor)
}

function makePeriod(granularity: Granularity, anchor: Date): PeriodRange {
  if (granularity === 'MONTHLY') {
    return {
      granularity,
      start: startOfMonth(anchor),
      end: endOfMonth(anchor),
      label: format(anchor, 'MMMM yyyy'),
    }
  }

  if (granularity === 'QUARTERLY') {
    return {
      granularity,
      start: startOfQuarter(anchor),
      end: endOfQuarter(anchor),
      label: `${format(anchor, 'yyyy')} Q${Math.floor(anchor.getMonth() / 3) + 1}`,
    }
  }

  return {
    granularity,
    start: startOfYear(anchor),
    end: endOfYear(anchor),
    label: format(anchor, 'yyyy'),
  }
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}
