import { useMemo } from 'react'
import type { GroupBy } from '../utils/spending'
import type { ChartView } from '../components/reports/SpendingBreakdown'
import type { Granularity, SpendingFilter, TransactionsFilter } from '../types/graphql'
import { getLastThreePeriodDateRange } from '../utils/dates'
import { SORT_PARAM } from './sortParam'
import { boolParam, enumParam, listParam, readParams } from './urlParams'
import { useParamSetMany, useParamSetters, useReportFilterParamCore } from './useReportFilterParamCore'
import { endOfMonth, format, startOfMonth } from 'date-fns'

const defaultDateFrom = (now: Date = new Date()) => format(startOfMonth(now), 'yyyy-MM-dd')
const defaultDateTo = (now: Date = new Date()) => format(endOfMonth(now), 'yyyy-MM-dd')

export type SpendingFilterTab = 'breakdown' | 'trends' | 'comparison'

const GROUP_BYS = ['category', 'group'] as const satisfies readonly GroupBy[]
const CHART_VIEWS = ['bar', 'pie'] as const satisfies readonly ChartView[]

const SPENDING_EXTRA_PARAMS = {
  categoryIds: listParam('category_ids'),
  accountIds: listParam('account_ids'),
  showHidden: boolParam('is_hidden'),
  groupBy: enumParam('group_by', GROUP_BYS, 'category'),
  breakdownView: enumParam('chart', CHART_VIEWS, 'bar'),
  sort: SORT_PARAM,
}

export function useSpendingFilterParams(tab: SpendingFilterTab) {
  const dateKeys = useMemo(() => dateParamKeys(tab), [tab])
  const core = useReportFilterParamCore({
    dateParamKeys: dateKeys,
    defaultDateRangeForGranularity: (granularity) => defaultDateRangeForSpendingTab(tab, granularity),
  })
  const { categoryIds, accountIds, showHidden, groupBy, breakdownView, sort } = useMemo(() => readParams(SPENDING_EXTRA_PARAMS, core.searchParams), [core.searchParams])
  const allParams = useMemo(() => ({ ...core.allParams, ...SPENDING_EXTRA_PARAMS }), [core.allParams])
  const setters = useParamSetters(SPENDING_EXTRA_PARAMS, core.pushParams, core.replaceParams)
  const setMany = useParamSetMany(allParams, core.pushParams)
  const isHidden = showHidden ? undefined : false

  const filter: SpendingFilter = useMemo(
    () => ({
      ...core.filter,
      isHidden,
      ...(categoryIds.length ? { categoryIds } : {}),
      ...(accountIds.length ? { accountIds } : {}),
    }),
    [core.filter, isHidden, categoryIds, accountIds],
  )

  const transactionFilter: TransactionsFilter = useMemo(
    () => ({
      datetimeRange: filter.datetimeRange,
      isHidden,
      ...(categoryIds.length ? { categoryIds } : {}),
      ...(accountIds.length ? { accountIds } : {}),
      ...(core.ownerIds.length ? { ownerIds: core.ownerIds } : {}),
    }),
    [filter.datetimeRange, isHidden, categoryIds, accountIds, core.ownerIds],
  )

  return {
    dateFrom: core.dateFrom, setDateFrom: core.setDateFrom,
    dateTo: core.dateTo, setDateTo: core.setDateTo,
    granularity: core.granularity, setGranularity: core.setGranularity,
    categoryIds, setCategoryIds: setters.setCategoryIds,
    accountIds, setAccountIds: setters.setAccountIds,
    ownerIds: core.ownerIds, setOwnerIds: core.setOwnerIds,
    showHidden: showHidden === true, setShowHidden: setters.setShowHidden,
    groupBy, setGroupBy: setters.setGroupBy,
    breakdownView, setBreakdownView: setters.setBreakdownView,
    sort, setSort: setters.setSort,
    setMany,
    filter,
    transactionFilter,
  }
}

export function defaultDateRangeForSpendingTab(tab: SpendingFilterTab, granularity: Granularity = 'MONTHLY', now: Date = new Date()) {
  if (tab === 'trends') return getLastThreePeriodDateRange(granularity, now)

  return {
    dateFrom: defaultDateFrom(now),
    dateTo: defaultDateTo(now),
  }
}

function dateParamKeys(tab: SpendingFilterTab) {
  if (tab === 'trends') return { from: 'trends_start_date', to: 'trends_end_date' }
  if (tab === 'comparison') return { from: 'comparison_start_date', to: 'comparison_end_date' }
  return { from: 'breakdown_start_date', to: 'breakdown_end_date' }
}
