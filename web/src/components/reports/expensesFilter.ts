import { endOfYear } from 'date-fns'
import type { TransactionsFilter } from '../../types/graphql'
import { localDateRangeFromDateTimeRange, localDateRangeToUtcDateTimeRange, toDateInputValue } from '../../utils/dates'
import { ALL_TIME_START } from './dateRangePresets'

export interface SpendingFilterValues {
  dateFrom: string
  dateTo: string
  categoryIds: string[]
  accountIds: string[]
  ownerIds: string[]
  showHidden: boolean
}

export function allTimeRange(now: Date) {
  return { dateFrom: toDateInputValue(ALL_TIME_START), dateTo: toDateInputValue(endOfYear(now)) }
}

export function isAllTime(values: Pick<SpendingFilterValues, 'dateFrom' | 'dateTo'>, now: Date) {
  const range = allTimeRange(now)
  return values.dateFrom === range.dateFrom && values.dateTo === range.dateTo
}

export function spendingFilterToTransactionsFilter(values: SpendingFilterValues, now: Date): TransactionsFilter {
  const list = (ids: string[]) => (ids.length ? ids : undefined)
  return {
    datetimeRange: isAllTime(values, now) ? undefined : localDateRangeToUtcDateTimeRange(values.dateFrom, values.dateTo),
    isHidden: values.showHidden ? undefined : false,
    categoryIds: list(values.categoryIds),
    accountIds: list(values.accountIds),
    ownerIds: list(values.ownerIds),
  }
}

export function spendingFilterFromTransactionsFilter(next: TransactionsFilter, current: SpendingFilterValues, now: Date): SpendingFilterValues {
  const range = next.datetimeRange ? localDateRangeFromDateTimeRange(next.datetimeRange) : allTimeRange(now)
  return {
    dateFrom: range.dateFrom ?? current.dateFrom,
    dateTo: range.dateTo ?? current.dateTo,
    categoryIds: next.categoryIds ?? [],
    accountIds: next.accountIds ?? [],
    ownerIds: next.ownerIds ?? [],
    showHidden: next.isHidden !== false,
  }
}

export function activeSpendingFilterCount(values: SpendingFilterValues, dateFiltered: boolean) {
  return values.categoryIds.length + values.accountIds.length + values.ownerIds.length + (dateFiltered ? 1 : 0) + (values.showHidden ? 1 : 0)
}
