import { useCallback, useMemo } from 'react'
import type { NetWorthRange } from '../types/graphql'
import { amountVisibilityFromParams, HIDE_AMOUNTS_PARAM } from './amountVisibilityParam'
import { clearParamUpdates, dateParam, enumParam, listParam, paramUpdate, readParams } from './urlParams'
import { useSearchParamWriters } from './useSearchParamWriters'

const NET_WORTH_RANGES = ['ONE_MONTH', 'THREE_MONTH', 'YTD', 'ONE_YEAR', 'ALL'] as const satisfies readonly NetWorthRange[]
const NET_WORTH_PARAMS = {
  range: enumParam('range', NET_WORTH_RANGES, 'YTD', true),
  ownerIds: listParam('owner'),
  accountIds: listParam('account_ids'),
  focusDate: dateParam('focus_date'),
}

type ListUpdate = string[] | ((ids: string[]) => string[])

export function useNetWorthParams() {
  const { searchParams, pushParams, replaceParams } = useSearchParamWriters()
  const { range, ownerIds, accountIds, focusDate } = useMemo(() => readParams(NET_WORTH_PARAMS, searchParams), [searchParams])
  const amountsHidden = amountVisibilityFromParams(searchParams)

  const setRange = useCallback((v: NetWorthRange) => {
    pushParams(paramUpdate(NET_WORTH_PARAMS.range, v))
  }, [pushParams])

  const setOwnerIds = useCallback((ids: ListUpdate) => {
    pushParams(paramUpdate(NET_WORTH_PARAMS.ownerIds, resolveListUpdate(ids, ownerIds)))
  }, [ownerIds, pushParams])

  const setAccountIds = useCallback((ids: ListUpdate) => {
    pushParams(paramUpdate(NET_WORTH_PARAMS.accountIds, resolveListUpdate(ids, accountIds)))
  }, [accountIds, pushParams])

  const setFocusDate = useCallback((date: string | null) => {
    pushParams(paramUpdate(NET_WORTH_PARAMS.focusDate, date ?? undefined))
  }, [pushParams])

  const toggleAmountsHidden = useCallback(() => {
    pushParams({ [HIDE_AMOUNTS_PARAM]: amountsHidden ? null : 'true' })
  }, [amountsHidden, pushParams])

  const clearAccountFilters = useCallback(() => {
    pushParams(paramUpdate(NET_WORTH_PARAMS.accountIds, []))
  }, [pushParams])

  const clearFilters = useCallback(() => {
    pushParams(clearParamUpdates({ ownerIds: NET_WORTH_PARAMS.ownerIds, accountIds: NET_WORTH_PARAMS.accountIds }))
  }, [pushParams])

  const replaceFilters = useCallback((nextOwnerIds: string[], nextAccountIds: string[]) => {
    replaceParams({
      ...paramUpdate(NET_WORTH_PARAMS.ownerIds, nextOwnerIds),
      ...paramUpdate(NET_WORTH_PARAMS.accountIds, nextAccountIds),
    })
  }, [replaceParams])

  return {
    range,
    ownerIds,
    accountIds,
    focusDate,
    amountsHidden,
    setRange,
    setOwnerIds,
    setAccountIds,
    setFocusDate,
    toggleAmountsHidden,
    clearAccountFilters,
    clearFilters,
    replaceFilters,
  }
}

function resolveListUpdate(update: ListUpdate, current: string[]) {
  return typeof update === 'function' ? update(current) : update
}
