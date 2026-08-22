import { useMemo } from 'react'
import type { GroupBy } from '../utils/spending'
import type { ChartView } from '../components/reports/SpendingBreakdown'
import type { TrendsChartView } from '../components/reports/SpendingTrends'
import type { Granularity, SpendingFilter, TransactionsFilter, TransactionSort } from '../types/graphql'
import { getLastThreePeriodDateRange } from '../utils/dates'
import { enumParam, listParam, readParams, type ParamCodec } from './urlParams'
import { useParamSetMany, useParamSetters, useReportFilterParamCore } from './useReportFilterParamCore'
import { endOfMonth, format, startOfMonth } from 'date-fns'

const defaultDateFrom = (now: Date = new Date()) => format(startOfMonth(now), 'yyyy-MM-dd')
const defaultDateTo = (now: Date = new Date()) => format(endOfMonth(now), 'yyyy-MM-dd')

export type SpendingFilterTab = 'breakdown' | 'trends' | 'comparison'

const GROUP_BYS = ['category', 'group'] as const satisfies readonly GroupBy[]
const CHART_VIEWS = ['bar', 'pie'] as const satisfies readonly ChartView[]
const TRENDS_VIEWS = ['stacked', 'line'] as const satisfies readonly TrendsChartView[]

const SPENDING_EXTRA_PARAMS = {
  categoryIds: listParam('category_ids'),
  groupBy: enumParam('group_by', GROUP_BYS, 'category'),
  breakdownView: enumParam('chart', CHART_VIEWS, 'bar'),
  trendsView: enumParam('trends_chart', TRENDS_VIEWS, 'stacked'),
  sort: transactionSortParam('sort'),
}

export function useSpendingFilterParams(tab: SpendingFilterTab) {
  const dateKeys = useMemo(() => dateParamKeys(tab), [tab])
  const core = useReportFilterParamCore({
    dateParamKeys: dateKeys,
    defaultDateRangeForGranularity: (granularity) => defaultDateRangeForSpendingTab(tab, granularity),
  })
  const { categoryIds, groupBy, breakdownView, trendsView, sort } = useMemo(() => readParams(SPENDING_EXTRA_PARAMS, core.searchParams), [core.searchParams])
  const allParams = useMemo(() => ({ ...core.allParams, ...SPENDING_EXTRA_PARAMS }), [core.allParams])
  const setters = useParamSetters(SPENDING_EXTRA_PARAMS, core.pushParams, core.replaceParams)
  const setMany = useParamSetMany(allParams, core.pushParams)

  const filter: SpendingFilter = useMemo(
    () => ({
      ...core.filter,
      ...(categoryIds.length ? { categoryIds } : {}),
    }),
    [core.filter, categoryIds],
  )

  const transactionFilter: TransactionsFilter = useMemo(
    () => ({
      datetimeRange: filter.datetimeRange,
      isHidden: false,
      ...(categoryIds.length ? { categoryIds } : {}),
      ...(core.ownerIds.length ? { ownerIds: core.ownerIds } : {}),
    }),
    [filter.datetimeRange, categoryIds, core.ownerIds],
  )

  return {
    dateFrom: core.dateFrom, setDateFrom: core.setDateFrom,
    dateTo: core.dateTo, setDateTo: core.setDateTo,
    granularity: core.granularity, setGranularity: core.setGranularity,
    categoryIds, setCategoryIds: setters.setCategoryIds,
    ownerIds: core.ownerIds, setOwnerIds: core.setOwnerIds,
    groupBy, setGroupBy: setters.setGroupBy,
    breakdownView, setBreakdownView: setters.setBreakdownView,
    trendsView, setTrendsView: setters.setTrendsView,
    sort, setSort: setters.setSort,
    setMany,
    filter,
    transactionFilter,
  }
}

function transactionSortParam(key: string): ParamCodec<TransactionSort> {
  return {
    key,
    read: (params) => params.get(key) === 'DATE:ASC' ? { field: 'DATE', direction: 'ASC' } : { field: 'DATE', direction: 'DESC' },
    write(params, value) {
      params.set(key, `${value.field}:${value.direction}`)
    },
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
