import { useCallback, useMemo } from 'react'
import type { Granularity, SpendingFilter } from '../types/graphql'
import { getLastThreePeriodDateRange, localDateRangeToUtcDateTimeRange } from '../utils/dates'
import { dateRangeParamUpdates, enumParam, listParam, paramUpdate, paramUpdates, readParams, stringParam, type ParamCodec } from './urlParams'
import { useSearchParamWriters } from './useSearchParamWriters'

export const GRANULARITIES: readonly Granularity[] = ['MONTHLY', 'QUARTERLY', 'YEARLY']

type DateParamKeys = { from: string; to: string }
type DateRangeValue = { dateFrom: string; dateTo: string }
type ParamWriteMode = 'push' | 'replace'
type ParamWriter = (updates: Record<string, string | null>) => void
type ParamCodecs = Record<string, ParamCodec<unknown>>
type ParamValues<C extends ParamCodecs> = {
  [K in keyof C]: C[K] extends ParamCodec<infer T> ? T : never
}
type ParamSetters<C extends ParamCodecs> = {
  [K in keyof C as `set${Capitalize<string & K>}`]: (value: ParamValues<C>[K], mode?: ParamWriteMode) => void
}

const REPORT_FILTER_PARAMS = {
  granularity: enumParam('granularity', GRANULARITIES, 'MONTHLY'),
  ownerIds: listParam('owner_ids'),
}

export function useReportFilterParamCore({
  dateParamKeys,
  defaultDateRangeForGranularity,
}: {
  dateParamKeys: DateParamKeys
  defaultDateRangeForGranularity: (granularity: Granularity) => DateRangeValue
}) {
  const { searchParams, pushParams, replaceParams } = useSearchParamWriters()
  const { granularity, ownerIds } = useMemo(() => readParams(REPORT_FILTER_PARAMS, searchParams), [searchParams])
  const defaultDateRange = defaultDateRangeForGranularity(granularity)
  const dateParams = useMemo(() => ({
    dateFrom: stringParam(dateParamKeys.from, defaultDateRange.dateFrom),
    dateTo: stringParam(dateParamKeys.to, defaultDateRange.dateTo),
  }), [dateParamKeys.from, dateParamKeys.to, defaultDateRange.dateFrom, defaultDateRange.dateTo])
  const { dateFrom, dateTo } = useMemo(() => readParams(dateParams, searchParams), [dateParams, searchParams])
  const allParams = useMemo(() => ({ ...REPORT_FILTER_PARAMS, ...dateParams }), [dateParams])
  const editableParams = useMemo(() => ({
    dateFrom: dateParams.dateFrom,
    dateTo: dateParams.dateTo,
    ownerIds: REPORT_FILTER_PARAMS.ownerIds,
  }), [dateParams])
  const { setDateFrom, setDateTo, setOwnerIds } = useParamSetters(editableParams, pushParams, replaceParams)
  const setMany = useParamSetMany(allParams, pushParams)

  const filter: SpendingFilter = useMemo(
    () => ({
      datetimeRange: localDateRangeToUtcDateTimeRange(dateFrom, dateTo) ?? {},
      granularity,
      isHidden: false,
      ...(ownerIds.length ? { ownerIds } : {}),
    }),
    [dateFrom, dateTo, granularity, ownerIds],
  )

  const setGranularity = useCallback((v: Granularity) => {
    pushParams(dateRangeParamUpdates({ granularity: REPORT_FILTER_PARAMS.granularity, ...dateParams }, v, getLastThreePeriodDateRange(v)))
  }, [dateParams, pushParams])

  return {
    searchParams, pushParams, replaceParams,
    allParams,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    granularity, setGranularity,
    ownerIds, setOwnerIds,
    setMany,
    filter,
  }
}

export function useParamSetters<C extends ParamCodecs>(codecs: C, pushParams: ParamWriter, replaceParams: ParamWriter): ParamSetters<C> {
  return useMemo(() => Object.fromEntries(
    Object.entries(codecs).map(([name, codec]) => [
      `set${name[0].toUpperCase()}${name.slice(1)}`,
      (value: unknown, mode: ParamWriteMode = 'push') => {
        const write = mode === 'push' ? pushParams : replaceParams
        write(paramUpdate(codec, value))
      },
    ]),
  ) as ParamSetters<C>, [codecs, pushParams, replaceParams])
}

export function useParamSetMany<C extends ParamCodecs>(codecs: C, pushParams: ParamWriter) {
  return useCallback((updates: Partial<ParamValues<C>>) => {
    pushParams(paramUpdates(codecs, updates))
  }, [codecs, pushParams])
}
