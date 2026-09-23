import { useCallback, useMemo, useRef, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import { useQuery } from 'urql'
import { differenceInCalendarDays, endOfISOWeek, endOfMonth, endOfYear, startOfISOWeek, startOfMonth, startOfYear, subMonths, subWeeks, subYears } from 'date-fns'
import { SPENDING_TOTALS_QUERY } from '../../graphql/queries'
import type { SpendingByCategoryReport, SpendingFilter } from '../../types/graphql'
import { useIsMobile } from '../../hooks/useIsMobile'
import { CHART_CURSOR, CHART_SURFACE, chartTheme, mobileTooltipProps } from '../../utils/chartStyles'
import { formatCurrency, formatCurrencyCompact } from '../../utils/currency'
import { localDateRangeToUtcDateTimeRange, toDateInputValue } from '../../utils/dates'
import { SelectField } from '../common/FormControls'
import { ChartTooltipBox, ChartTooltipRow, ChartTooltipTitle } from '../common/ChartTooltip'
import { buildComparisonPoints, comparisonTickLabels, type ComparisonMode, type ComparisonPoint } from './spendingComparisonData'

const CURRENT_COLOR = '#f76b15'
const HISTORICAL_COLOR = 'rgb(var(--text-faint))'

const COMPARISON_OPTIONS: ReadonlyArray<{ value: ComparisonMode; label: string }> = [
  { value: 'month-vs-last-month', label: 'This month vs. last month' },
  { value: 'month-vs-last-year', label: 'This month vs. last year' },
  { value: 'year-vs-last-year', label: 'This year vs. last year' },
  { value: 'week-vs-last-week', label: 'This week vs. last week' },
]

interface PeriodConfig {
  granularity: 'DAILY' | 'WEEKLY'
  currentStart: Date
  currentEnd: Date
  historicalStart: Date
  historicalEnd: Date
  currentLabel: string
  historicalLabel: string
}

type PeriodDefinition = Pick<PeriodConfig, 'granularity' | 'currentLabel' | 'historicalLabel'> & { start: (date: Date) => Date; end: (date: Date) => Date; shift: (date: Date) => Date }

const PERIOD_DEFINITIONS: Record<ComparisonMode, PeriodDefinition> = {
  'month-vs-last-month': { granularity: 'DAILY', start: startOfMonth, end: endOfMonth, shift: (date) => subMonths(date, 1), currentLabel: 'This month', historicalLabel: 'Last month' },
  'month-vs-last-year': { granularity: 'DAILY', start: startOfMonth, end: endOfMonth, shift: (date) => subYears(date, 1), currentLabel: 'This month', historicalLabel: 'This month last year' },
  'year-vs-last-year': { granularity: 'WEEKLY', start: startOfYear, end: endOfYear, shift: (date) => subYears(date, 1), currentLabel: 'This year', historicalLabel: 'Last year' },
  'week-vs-last-week': { granularity: 'DAILY', start: startOfISOWeek, end: endOfISOWeek, shift: (date) => subWeeks(date, 1), currentLabel: 'This week', historicalLabel: 'Last week' },
}

function getPeriodConfig(mode: ComparisonMode, now: Date): PeriodConfig {
  const { start, end, shift, ...labels } = PERIOD_DEFINITIONS[mode]
  const historical = shift(now)
  return { ...labels, currentStart: start(now), currentEnd: end(now), historicalStart: start(historical), historicalEnd: end(historical) }
}

export function SpendingComparison({ accountIds, categoryIds, owners, showHidden = false }: { accountIds?: string[]; categoryIds: string[]; owners?: string[]; showHidden?: boolean }) {
  const [mode, setMode] = useState<ComparisonMode>('month-vs-last-month')
  const isMobile = useIsMobile()
  const containerRef = useRef<HTMLDivElement>(null)
  const now = useMemo(() => new Date(), [])
  const config = useMemo(() => getPeriodConfig(mode, now), [mode, now])

  const makeFilter = useCallback((start: Date, end: Date): SpendingFilter => ({
    datetimeRange: localDateRangeToUtcDateTimeRange(toDateInputValue(start), toDateInputValue(end)) ?? {},
    granularity: config.granularity,
    isHidden: showHidden ? undefined : false,
    ...(categoryIds.length ? { categoryIds } : {}),
    ...(accountIds?.length ? { accountIds } : {}),
    ...(owners?.length ? { ownerIds: owners } : {}),
  }), [config.granularity, categoryIds, accountIds, owners, showHidden])

  const currentFilter = useMemo(() => makeFilter(config.currentStart, config.currentEnd), [makeFilter, config.currentStart, config.currentEnd])
  const historicalFilter = useMemo(() => makeFilter(config.historicalStart, config.historicalEnd), [makeFilter, config.historicalStart, config.historicalEnd])

  const [currentResult] = useQuery<{ spendingByCategory: SpendingByCategoryReport }, { filter: SpendingFilter }>({ query: SPENDING_TOTALS_QUERY, variables: { filter: currentFilter } })
  const [historicalResult] = useQuery<{ spendingByCategory: SpendingByCategoryReport }, { filter: SpendingFilter }>({ query: SPENDING_TOTALS_QUERY, variables: { filter: historicalFilter } })

  const todayIndex = useMemo(() => {
    const diff = differenceInCalendarDays(now, config.currentStart)
    return config.granularity === 'WEEKLY' ? Math.floor(diff / 7) : diff
  }, [now, config])

  const points = useMemo(
    () => buildComparisonPoints(currentResult.data?.spendingByCategory.periods ?? [], historicalResult.data?.spendingByCategory.periods ?? [], mode, todayIndex),
    [currentResult.data?.spendingByCategory.periods, historicalResult.data?.spendingByCategory.periods, mode, todayIndex],
  )
  const showCurrent = todayIndex >= 1
  const todayPoint = points[todayIndex]
  const ticks = comparisonTickLabels(points, isMobile ? [0, 0.32, 0.65, 1] : [0, 0.2, 0.4, 0.6, 0.8, 1])

  return (
    <div className="mt-5 lg:mt-7">
      <SelectField className="w-full lg:w-56" hideLabel label="Comparison period" onChange={setMode} options={COMPARISON_OPTIONS} value={mode} />
      <div className="mt-4 h-[180px] lg:h-[280px]" ref={containerRef}>
        <ResponsiveContainer height="100%" width="100%">
          <ComposedChart data={points} margin={{ top: 8, right: isMobile ? 4 : 24, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="comparisonFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={CURRENT_COLOR} stopOpacity={0.35} />
                <stop offset="100%" stopColor={CURRENT_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={chartTheme.grid.stroke} strokeDasharray={chartTheme.grid.strokeDasharray} vertical={false} />
            <XAxis axisLine={false} dataKey="label" interval={0} tick={chartTheme.axisTick} tickLine={false} tickMargin={10} ticks={ticks} />
            <YAxis axisLine={false} domain={[0, 'auto']} hide={isMobile} tick={chartTheme.axisTick} tickCount={5} tickFormatter={(value: number) => formatCurrencyCompact(value)} tickLine={false} width={52} />
            <ReferenceLine stroke={chartTheme.baseline.stroke} y={0} />
            <Tooltip {...mobileTooltipProps(isMobile)} content={(props) => <ComparisonTooltip {...props} clampWidth={isMobile ? containerRef.current?.clientWidth : undefined} currentLabel={config.currentLabel} historicalLabel={config.historicalLabel} />} cursor={CHART_CURSOR} />
            <Line activeDot={{ r: 4, fill: CHART_SURFACE, stroke: HISTORICAL_COLOR, strokeWidth: 2 }} connectNulls={false} dataKey="historical" dot={false} isAnimationActive={false} name={config.historicalLabel} stroke={HISTORICAL_COLOR} strokeWidth={chartTheme.line.strokeWidth} type="linear" />
            {showCurrent ? (
              <Area activeDot={{ r: 4, fill: CHART_SURFACE, stroke: CURRENT_COLOR, strokeWidth: 2 }} connectNulls={false} dataKey="current" dot={false} fill="url(#comparisonFill)" isAnimationActive={false} name={config.currentLabel} stroke={CURRENT_COLOR} strokeWidth={chartTheme.line.strokeWidth} type="linear" />
            ) : null}
            {showCurrent && todayPoint?.current != null ? (
              <>
                <ReferenceLine stroke={CHART_CURSOR.stroke} strokeDasharray={CHART_CURSOR.strokeDasharray} x={todayPoint.label} />
                <ReferenceDot fill={CHART_SURFACE} r={4} stroke={CURRENT_COLOR} strokeWidth={1.5} x={todayPoint.label} y={todayPoint.current} />
              </>
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {!showCurrent ? <p className="mt-3 text-center text-[13px] text-text-muted">Not enough of {config.currentLabel.toLowerCase()} yet — showing {config.historicalLabel.toLowerCase()} only.</p> : null}
      <div className="mt-5 flex items-center justify-center gap-6 text-[13px]">
        <span className="flex items-center gap-2 text-text-3"><span aria-hidden className="inline-block h-px w-4 bg-text-faint" />{config.historicalLabel}</span>
        {showCurrent ? <span className="flex items-center gap-2 font-medium" style={{ color: CURRENT_COLOR }}><span aria-hidden className="inline-block h-px w-4" style={{ backgroundColor: CURRENT_COLOR }} />{config.currentLabel}</span> : null}
      </div>
    </div>
  )
}

function ComparisonTooltip({ active, clampWidth, coordinate, currentLabel, historicalLabel, label, payload }: TooltipContentProps & { clampWidth?: number; currentLabel: string; historicalLabel: string }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload as ComparisonPoint | undefined
  if (!point || (point.current == null && point.historical == null)) return null

  return (
    <ChartTooltipBox clampWidth={clampWidth} coordinate={coordinate}>
      <ChartTooltipTitle>{String(label ?? point.label)}</ChartTooltipTitle>
      {point.current != null ? <ChartTooltipRow color={CURRENT_COLOR} label={currentLabel} value={formatCurrency(point.current)} /> : null}
      {point.historical != null ? <ChartTooltipRow color={HISTORICAL_COLOR} label={historicalLabel} value={formatCurrency(point.historical)} /> : null}
    </ChartTooltipBox>
  )
}
