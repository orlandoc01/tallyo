import { addDays, differenceInCalendarDays, differenceInCalendarMonths, endOfMonth, isFirstDayOfMonth, isLastDayOfMonth, startOfMonth, subMonths } from 'date-fns'
import { parseLocalDate, toDateInputValue } from '../../utils/dates'

interface DateRange { dateFrom: string; dateTo: string }

export interface PreviousRange extends DateRange { label: string }

// Whole calendar months step back by the same number of months; any other span
// steps back by its own length, ending the day before it starts.
export function previousRange({ dateFrom, dateTo }: DateRange): PreviousRange {
  const from = parseLocalDate(dateFrom)
  const to = parseLocalDate(dateTo)
  if (isFirstDayOfMonth(from) && isLastDayOfMonth(to)) {
    const months = differenceInCalendarMonths(to, from) + 1
    return {
      dateFrom: toDateInputValue(startOfMonth(subMonths(from, months))),
      dateTo: toDateInputValue(endOfMonth(subMonths(to, months))),
      label: months === 1 ? 'vs last month' : `vs prior ${months} months`,
    }
  }
  const days = differenceInCalendarDays(to, from) + 1
  return {
    dateFrom: toDateInputValue(addDays(from, -days)),
    dateTo: toDateInputValue(addDays(from, -1)),
    label: `vs prior ${days} days`,
  }
}

export function elapsedDays({ dateFrom, dateTo }: DateRange, now: Date) {
  const from = parseLocalDate(dateFrom)
  const to = parseLocalDate(dateTo)
  const total = Math.max(1, differenceInCalendarDays(to, from) + 1)
  const elapsed = Math.min(total, Math.max(0, differenceInCalendarDays(now, from) + 1))
  return { elapsed, total }
}

export function dailyAverage(total: number, elapsed: number) {
  return elapsed > 0 ? total / elapsed : 0
}

export function spendingDelta(current: number, previous: number | null | undefined) {
  if (previous == null || previous <= 0) return null
  const changeUSD = current - previous
  return { changeUSD, changePct: (changeUSD / previous) * 100 }
}
