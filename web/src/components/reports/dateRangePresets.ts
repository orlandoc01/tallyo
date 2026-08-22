import { endOfMonth, endOfYear, format, startOfMonth, startOfYear, subMonths, subYears } from 'date-fns'

type DateRangePreset = 'this_month' | 'last_month' | 'this_year' | 'last_year' | 'last_3_months' | 'all'

export type DateRangePresetOption = {
  label: string
  value: DateRangePreset
  dateFrom?: string
  dateTo?: string
}

export const dateRangePresets: DateRangePresetOption[] = [
  { label: 'This month', value: 'this_month' },
  { label: 'Last month', value: 'last_month' },
  { label: 'This year', value: 'this_year' },
  { label: 'Last year', value: 'last_year' },
]

export function getDateRangePresetDates(preset: DateRangePreset, now: Date = new Date()) {
  if (preset === 'this_month') {
    return formatDateRange(startOfMonth(now), endOfMonth(now))
  }
  if (preset === 'last_month') {
    const lastMonth = subMonths(now, 1)
    return formatDateRange(startOfMonth(lastMonth), endOfMonth(lastMonth))
  }
  if (preset === 'this_year') {
    return formatDateRange(startOfYear(now), endOfYear(now))
  }
  if (preset === 'last_3_months') {
    return formatDateRange(startOfMonth(subMonths(now, 2)), endOfMonth(now))
  }
  if (preset === 'all') {
    return formatDateRange(new Date(2000, 0, 1), endOfYear(now))
  }
  const lastYear = subYears(now, 1)
  return formatDateRange(startOfYear(lastYear), endOfYear(lastYear))
}

function formatDateRange(dateFrom: Date, dateTo: Date) {
  return {
    dateFrom: format(dateFrom, 'yyyy-MM-dd'),
    dateTo: format(dateTo, 'yyyy-MM-dd'),
  }
}
