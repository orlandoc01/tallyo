import { useCallback, useMemo } from 'react'
import type { TransactionsFilter, TransactionSort } from '../types/graphql'
import { localDateRangeFromDateTimeRange, localDateRangeToUtcDateTimeRange } from '../utils/dates'
import { boolParam, clearParamUpdates, optionalListParam, numberParam, paramUpdate, paramUpdates, readParams, stringParam, type ParamCodec } from './urlParams'
import { SORT_PARAM } from './sortParam'
import { useSearchParamWriters } from './useSearchParamWriters'

const TRANSACTION_FILTER_PARAMS = {
  ownerIds: optionalListParam('owner_ids'),
  accountIds: optionalListParam('account_ids'),
  categoryIds: optionalListParam('category_ids'),
  tagIds: optionalListParam('tag_ids'),
  untagged: boolParam('untagged'),
  datetimeRange: dateTimeRangeParam('start_date', 'end_date'),
  merchantPrefix: stringParam('merchant_prefix'),
  originalPrefix: stringParam('original_prefix'),
  isHidden: includeHiddenParam('is_hidden'),
  excludeTransfers: boolParam('exclude_transfers'),
  excludeIncome: boolParam('exclude_income'),
  amountMin: numberParam('amount_min'),
  amountMax: numberParam('amount_max'),
  exactAmount: numberParam('exact_amount'),
}

const TEXT_FILTER_FIELDS = new Set<keyof typeof TRANSACTION_FILTER_PARAMS>(['merchantPrefix', 'originalPrefix'])
const NON_TEXT_FILTER_FIELDS = (Object.keys(TRANSACTION_FILTER_PARAMS) as Array<keyof typeof TRANSACTION_FILTER_PARAMS>).filter((field) => !TEXT_FILTER_FIELDS.has(field))

export function useTransactionFilterParams() {
  const { searchParams, pushParams, replaceParams } = useSearchParamWriters()

  const filter = useMemo(() => transactionFilterFromParams(searchParams), [searchParams])

  const sort = useMemo<TransactionSort>(() => SORT_PARAM.read(searchParams), [searchParams])

  const setFilter = useCallback(
    (updater: TransactionsFilter | ((prev: TransactionsFilter) => TransactionsFilter), mode: 'push' | 'replace' = 'push') => {
      const nextVal = typeof updater === 'function' ? updater(filter) : updater
      const write = mode === 'push' ? pushParams : replaceParams
      write(paramUpdates(TRANSACTION_FILTER_PARAMS, nextVal, true))
    },
    [filter, pushParams, replaceParams],
  )

  const setSort = useCallback(
    (next: TransactionSort, mode: 'push' | 'replace' = 'push') => {
      const write = mode === 'push' ? pushParams : replaceParams
      write(paramUpdate(SORT_PARAM, next))
    },
    [pushParams, replaceParams],
  )

  const setFilterAndSort = useCallback(
    (nextFilter: TransactionsFilter, nextSort: TransactionSort, mode: 'push' | 'replace' = 'push') => {
      const write = mode === 'push' ? pushParams : replaceParams
      write({ ...paramUpdates(TRANSACTION_FILTER_PARAMS, nextFilter, true), ...paramUpdate(SORT_PARAM, nextSort) })
    },
    [pushParams, replaceParams],
  )

  const clearFilters = useCallback(() => {
    replaceParams({ ...clearParamUpdates(TRANSACTION_FILTER_PARAMS), q: null, sort: null })
  }, [replaceParams])

  return { filter, sort, setFilter, setSort, setFilterAndSort, clearFilters }
}

// True when a filter field other than the free-text prefixes changed — used to
// decide between pushing a history entry and replacing the current one.
export function didNonTextFilterChange(previous: TransactionsFilter, next: TransactionsFilter) {
  return NON_TEXT_FILTER_FIELDS.some((field) => transactionFilterValue(previous, field) !== transactionFilterValue(next, field))
}

// Number of active filters, counting the free-text search, for badge display.
export function activeTransactionFilterCount(filter: TransactionsFilter, search: string) {
  return (search ? 1 : 0)
    + (Object.keys(TRANSACTION_FILTER_PARAMS) as Array<keyof typeof TRANSACTION_FILTER_PARAMS>).reduce((total, field) => total + transactionFilterCount(filter, field), 0)
}

function transactionFilterFromParams(searchParams: URLSearchParams): TransactionsFilter {
  return Object.fromEntries(
    Object.entries(readParams(TRANSACTION_FILTER_PARAMS, searchParams)).filter(([, value]) => value !== undefined),
  ) as TransactionsFilter
}

function dateTimeRangeParam(fromKey: string, toKey: string): ParamCodec<TransactionsFilter['datetimeRange'] | null | undefined> {
  return {
    key: fromKey,
    keys: [fromKey, toKey],
    read(params) {
      const dateFrom = params.get(fromKey)
      const dateTo = params.get(toKey)
      return dateFrom || dateTo ? localDateRangeToUtcDateTimeRange(dateFrom ?? undefined, dateTo ?? undefined) : undefined
    },
    write(params, value) {
      params.delete(fromKey)
      params.delete(toKey)
      if (!value) return
      const { dateFrom, dateTo } = localDateRangeFromDateTimeRange(value)
      if (dateFrom) params.set(fromKey, dateFrom)
      if (dateTo) params.set(toKey, dateTo)
    },
  }
}

function includeHiddenParam(key: string): ParamCodec<boolean | null | undefined> {
  return {
    key,
    read: (params) => params.get(key) === '1' ? undefined : false,
    write(params, value) {
      if (value === false) params.delete(key)
      else params.set(key, '1')
    },
  }
}

function transactionFilterValue(filter: TransactionsFilter, field: keyof typeof TRANSACTION_FILTER_PARAMS) {
  if (field === 'datetimeRange') return `${filter.datetimeRange?.from ?? ''}|${filter.datetimeRange?.to ?? ''}`
  return filter[field]
}

function transactionFilterCount(filter: TransactionsFilter, field: keyof typeof TRANSACTION_FILTER_PARAMS) {
  if (field === 'datetimeRange') return (filter.datetimeRange?.from ? 1 : 0) + (filter.datetimeRange?.to ? 1 : 0)
  if (field === 'isHidden') return filter.isHidden !== false ? 1 : 0

  const value = filter[field]
  if (Array.isArray(value)) return value.length
  if (typeof value === 'number') return 1
  return value ? 1 : 0
}
