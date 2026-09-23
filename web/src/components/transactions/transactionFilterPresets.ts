import { addDays, endOfMonth, startOfMonth, startOfYear, subMonths } from 'date-fns'
import type { TransactionSort, TransactionsFilter } from '../../types/graphql'
import { formatDisplayDate, localDateRangeFromDateTimeRange, localDateRangeToUtcDateTimeRange, toDateInputValue } from '../../utils/dates'
import { datePresetHint as rangeHint, presetById, selectedDatePreset as selectedPreset, type DatePreset } from '../../utils/datePresets'
import { formatCurrency } from '../../utils/currency'

export type DatePresetId = 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30' | 'LAST_90' | 'YTD' | 'ALL'

export const DATE_PRESETS: ReadonlyArray<DatePreset<DatePresetId>> = [
  { id: 'THIS_MONTH', label: 'This month', range: (now) => ({ dateFrom: toDateInputValue(startOfMonth(now)), dateTo: toDateInputValue(endOfMonth(now)) }) },
  { id: 'LAST_MONTH', label: 'Last month', range: (now) => ({ dateFrom: toDateInputValue(startOfMonth(subMonths(now, 1))), dateTo: toDateInputValue(endOfMonth(subMonths(now, 1))) }) },
  { id: 'LAST_30', label: 'Last 30 days', range: (now) => ({ dateFrom: toDateInputValue(addDays(now, -29)), dateTo: toDateInputValue(now) }) },
  { id: 'LAST_90', label: 'Last 90 days', range: (now) => ({ dateFrom: toDateInputValue(addDays(now, -89)), dateTo: toDateInputValue(now) }) },
  { id: 'YTD', label: 'Year to date', range: (now) => ({ dateFrom: toDateInputValue(startOfYear(now)), dateTo: toDateInputValue(now) }) },
  { id: 'ALL', label: 'All time', range: () => ({}) },
]

export function datePresetHint(id: DatePresetId, now: Date) {
  return rangeHint(presetById(DATE_PRESETS, id).range(now))
}

export function datePresetRange(id: DatePresetId, now: Date) {
  const { dateFrom, dateTo } = presetById(DATE_PRESETS, id).range(now)
  return localDateRangeToUtcDateTimeRange(dateFrom, dateTo)
}

export function selectedDatePreset(filter: TransactionsFilter, now: Date): DatePresetId | undefined {
  return selectedPreset(DATE_PRESETS, localDateRangeFromDateTimeRange(filter.datetimeRange ?? undefined), now)?.id
}

export function dateRangeSummary(filter: TransactionsFilter, now: Date): string | undefined {
  if (!filter.datetimeRange) return undefined
  const preset = selectedDatePreset(filter, now)
  if (preset) return presetById(DATE_PRESETS, preset).label
  const { dateFrom, dateTo } = localDateRangeFromDateTimeRange(filter.datetimeRange)
  const label = (value?: string) => value ? formatDisplayDate(value) : '…'
  return `${label(dateFrom)} – ${label(dateTo)}`
}

export type AmountMode = 'expenses' | 'income' | 'both'

export const AMOUNT_MODES: ReadonlyArray<{ id: AmountMode; label: string }> = [
  { id: 'expenses', label: 'Expenses' },
  { id: 'income', label: 'Income' },
  { id: 'both', label: 'Both' },
]

// Income has no dedicated API flag: amounts ≤ 0 are credits, so "income only"
// is expressed as amountMax 0; "expenses" reuses excludeIncome.
export function amountMode(filter: TransactionsFilter): AmountMode {
  if (filter.excludeIncome) return 'expenses'
  if (filter.amountMax === 0) return 'income'
  return 'both'
}

export function withAmountMode(filter: TransactionsFilter, mode: AmountMode): TransactionsFilter {
  const base = { ...filter, excludeIncome: undefined, amountMax: filter.amountMax === 0 ? undefined : filter.amountMax }
  if (mode === 'expenses') return { ...base, excludeIncome: true }
  if (mode === 'income') return { ...base, amountMax: 0, amountMin: undefined }
  return base
}

export type AmountPresetId = 'UNDER_50' | 'FROM_50_TO_500' | 'OVER_500' | 'INCOME'

export const AMOUNT_PRESETS: ReadonlyArray<{ id: AmountPresetId; label: string; apply: (filter: TransactionsFilter) => TransactionsFilter }> = [
  { id: 'UNDER_50', label: '< $50', apply: (filter) => ({ ...withAmountMode(filter, 'both'), amountMin: undefined, amountMax: 50, exactAmount: undefined }) },
  { id: 'FROM_50_TO_500', label: '$50–$500', apply: (filter) => ({ ...withAmountMode(filter, 'both'), amountMin: 50, amountMax: 500, exactAmount: undefined }) },
  { id: 'OVER_500', label: '> $500', apply: (filter) => ({ ...withAmountMode(filter, 'both'), amountMin: 500, amountMax: undefined, exactAmount: undefined }) },
  { id: 'INCOME', label: 'Income only', apply: (filter) => ({ ...withAmountMode(filter, 'income'), exactAmount: undefined }) },
]

export function selectedAmountPreset(filter: TransactionsFilter): AmountPresetId | undefined {
  if (filter.exactAmount != null) return undefined
  if (amountMode(filter) === 'income') return 'INCOME'
  if (filter.amountMin == null && filter.amountMax === 50) return 'UNDER_50'
  if (filter.amountMin === 50 && filter.amountMax === 500) return 'FROM_50_TO_500'
  if (filter.amountMin === 500 && filter.amountMax == null) return 'OVER_500'
  return undefined
}

export function amountSummary(filter: TransactionsFilter): string | undefined {
  const mode = amountMode(filter)
  const range = filter.exactAmount != null
    ? `= ${formatCurrency(filter.exactAmount)}`
    : mode === 'income' ? undefined
      : filter.amountMin != null && filter.amountMax != null ? `${formatCurrency(filter.amountMin)}–${formatCurrency(filter.amountMax)}`
        : filter.amountMin != null ? `> ${formatCurrency(filter.amountMin)}`
          : filter.amountMax != null ? `< ${formatCurrency(filter.amountMax)}`
            : undefined
  const parts = [range, mode === 'both' ? undefined : AMOUNT_MODES.find((option) => option.id === mode)!.label].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}

export type SortId = `${TransactionSort['field']}:${TransactionSort['direction']}`

export const SORT_OPTIONS: ReadonlyArray<{ id: SortId; label: string; sort: TransactionSort }> = [
  { id: 'DATE:DESC', label: 'Newest first', sort: { field: 'DATE', direction: 'DESC' } },
  { id: 'DATE:ASC', label: 'Oldest first', sort: { field: 'DATE', direction: 'ASC' } },
  { id: 'AMOUNT:DESC', label: 'Largest first', sort: { field: 'AMOUNT', direction: 'DESC' } },
  { id: 'AMOUNT:ASC', label: 'Smallest first', sort: { field: 'AMOUNT', direction: 'ASC' } },
]

export function sortId(sort: TransactionSort): SortId {
  return `${sort.field}:${sort.direction}`
}

export function sortFromId(id: string): TransactionSort {
  return (SORT_OPTIONS.find((option) => option.id === id) ?? SORT_OPTIONS[0]).sort
}
