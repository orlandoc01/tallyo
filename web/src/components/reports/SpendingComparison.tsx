import { useCallback, useMemo, useState } from 'react'
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import { ChevronDown } from 'lucide-react'
import { useQuery } from 'urql'
import {
  differenceInCalendarDays,
  endOfISOWeek,
  endOfMonth,
  endOfYear,
  startOfISOWeek,
  startOfMonth,
  startOfYear,
  subMonths,
  subWeeks,
  subYears,
} from 'date-fns'
import { SPENDING_TOTALS_QUERY } from '../../graphql/queries'
import type { SpendingByCategoryReport, SpendingFilter } from '../../types/graphql'
import { localDateRangeToUtcDateTimeRange, toDateInputValue } from '../../utils/dates'
import { formatCurrency, formatCurrencyCompact } from '../../utils/currency'
import { useIsMobile } from '../../hooks/useIsMobile'
import { Card } from '../common/FormControls'
import { reportChartAxes } from './chartAxes'
import { buildComparisonPoints, type ComparisonMode, type ComparisonPoint } from './spendingComparisonData'

const COMPARISON_OPTIONS: { value: ComparisonMode; label: string }[] = [
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
  periodTitle: string
}

type PeriodDefinition = Pick<PeriodConfig, 'granularity' | 'currentLabel' | 'historicalLabel' | 'periodTitle'> & { start: (date: Date) => Date; end: (date: Date) => Date; shift: (date: Date) => Date }

const PERIOD_DEFINITIONS: Record<ComparisonMode, PeriodDefinition> = {
  'month-vs-last-month': { granularity: 'DAILY', start: startOfMonth, end: endOfMonth, shift: (date) => subMonths(date, 1), currentLabel: 'This month', historicalLabel: 'Last month', periodTitle: 'this month' },
  'month-vs-last-year': { granularity: 'DAILY', start: startOfMonth, end: endOfMonth, shift: (date) => subYears(date, 1), currentLabel: 'This month', historicalLabel: 'This month last year', periodTitle: 'this month' },
  'year-vs-last-year': { granularity: 'WEEKLY', start: startOfYear, end: endOfYear, shift: (date) => subYears(date, 1), currentLabel: 'This year', historicalLabel: 'Last year', periodTitle: 'this year' },
  'week-vs-last-week': { granularity: 'DAILY', start: startOfISOWeek, end: endOfISOWeek, shift: (date) => subWeeks(date, 1), currentLabel: 'This week', historicalLabel: 'Last week', periodTitle: 'this week' },
}

function getPeriodConfig(mode: ComparisonMode, now: Date): PeriodConfig {
  const { start, end, shift, ...labels } = PERIOD_DEFINITIONS[mode]
  const historical = shift(now)
  return {
    ...labels,
    currentStart: start(now),
    currentEnd: end(now),
    historicalStart: start(historical),
    historicalEnd: end(historical),
  }
}

function quarterTicks(points: ComparisonPoint[]): string[] {
  const n = points.length
  if (n === 0) return []
  return [0, 0.25, 0.5, 0.75]
    .map((frac) => Math.min(Math.round(n * frac), n - 1))
    .filter((idx, i, arr) => arr.indexOf(idx) === i)
    .map((idx) => points[idx].label)
}

export function SpendingComparison({ categoryIds, owners }: { categoryIds: string[]; owners?: string[] }) {
  const [mode, setMode] = useState<ComparisonMode>('month-vs-last-month')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const now = useMemo(() => new Date(), [])
  const config = useMemo(() => getPeriodConfig(mode, now), [mode, now])

  const makeFilter = useCallback((start: Date, end: Date): SpendingFilter => ({
    datetimeRange: localDateRangeToUtcDateTimeRange(toDateInputValue(start), toDateInputValue(end)) ?? {},
    granularity: config.granularity,
    isHidden: false,
    ...(categoryIds.length ? { categoryIds } : {}),
    ...(owners?.length ? { ownerIds: owners } : {}),
  }), [config.granularity, categoryIds, owners])

  const currentFilter = useMemo(() => makeFilter(config.currentStart, config.currentEnd), [makeFilter, config.currentStart, config.currentEnd])
  const historicalFilter = useMemo(() => makeFilter(config.historicalStart, config.historicalEnd), [makeFilter, config.historicalStart, config.historicalEnd])

  const [currentResult] = useQuery<{ spendingByCategory: SpendingByCategoryReport }, { filter: SpendingFilter }>({
    query: SPENDING_TOTALS_QUERY,
    variables: { filter: currentFilter },
  })
  const [historicalResult] = useQuery<{ spendingByCategory: SpendingByCategoryReport }, { filter: SpendingFilter }>({
    query: SPENDING_TOTALS_QUERY,
    variables: { filter: historicalFilter },
  })

  const currentTotal = currentResult.data?.spendingByCategory.totalAmount ?? 0
  const todayIndex = useMemo(() => {
    const diff = differenceInCalendarDays(now, config.currentStart)
    return config.granularity === 'WEEKLY' ? Math.floor(diff / 7) : diff
  }, [now, config])

  const points = useMemo(
    () => buildComparisonPoints(currentResult.data?.spendingByCategory.periods ?? [], historicalResult.data?.spendingByCategory.periods ?? [], mode, todayIndex),
    [currentResult.data?.spendingByCategory.periods, historicalResult.data?.spendingByCategory.periods, mode, todayIndex],
  )

  const isMobile = useIsMobile()
  const chartHeight = isMobile ? 260 : 320
  const yAxisWidth = isMobile ? 56 : 88
  const yAxisFormatter = isMobile ? formatCurrencyCompact : formatCurrency
  const desktopInterval = mode === 'week-vs-last-week' ? 0 : mode === 'year-vs-last-year' ? 3 : 2
  const mobileXTicks = isMobile && mode !== 'week-vs-last-week' ? quarterTicks(points) : undefined

  const modeLabel = COMPARISON_OPTIONS.find((o) => o.value === mode)?.label ?? ''

  return (
    <Card as="section" overflow="visible">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 p-5">
        <div className="min-w-0">
          <span className="text-base font-bold">Spending </span>
          <span className="text-base font-bold" style={{ color: '#f97316' }}>{formatCurrency(currentTotal)}</span>
          <span className="ml-1.5 text-sm text-neutral-500">{config.periodTitle}</span>
        </div>
        <div className="relative shrink-0">
          <button
            aria-expanded={dropdownOpen}
            className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
            onClick={() => setDropdownOpen((o) => !o)}
            type="button"
          >
            {modeLabel}
            <ChevronDown className="h-4 w-4 text-neutral-400" />
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 z-20 mt-1 w-64 rounded-2xl border border-neutral-200 bg-white py-1 shadow-card">
              {COMPARISON_OPTIONS.map((option) => (
                <button
                  className={`w-full px-4 py-2.5 text-left text-sm hover:bg-neutral-50 ${mode === option.value ? 'font-semibold text-brand-600' : 'text-neutral-700'}`}
                  key={option.value}
                  onClick={() => { setMode(option.value); setDropdownOpen(false) }}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="py-5 lg:px-5">
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer height="100%" width="100%">
            <ComposedChart data={points}>
              {reportChartAxes({ dataKey: 'label', xAxisProps: { interval: mobileXTicks ? 0 : desktopInterval, ticks: mobileXTicks }, yAxisFormatter, yAxisWidth })}
              <Tooltip content={<ComparisonTooltip currentLabel={config.currentLabel} historicalLabel={config.historicalLabel} />} />
              <Area
                connectNulls={false}
                dataKey="current"
                dot={currentEndDot(todayIndex)}
                fill="#f97316"
                fillOpacity={0.15}
                name={config.currentLabel}
                stroke="#f97316"
                strokeWidth={2.5}
                type="monotone"
              />
              <Line
                connectNulls={false}
                dataKey="historical"
                dot={false}
                name={config.historicalLabel}
                stroke="#71717a"
                strokeWidth={2.5}
                type="monotone"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="flex items-center justify-center gap-8 border-t border-neutral-100 p-4 text-sm">
        <span className="flex items-center gap-2 text-neutral-500">
          <span className="inline-block h-0.5 w-5 rounded bg-neutral-400" />
          {config.historicalLabel}
        </span>
        <span className="flex items-center gap-2 font-semibold" style={{ color: '#f97316' }}>
          <span className="inline-block h-0.5 w-5 rounded" style={{ backgroundColor: '#f97316' }} />
          {config.currentLabel}
        </span>
      </div>
    </Card>
  )
}

function currentEndDot(todayIndex: number) {
  return (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props
    if (index !== todayIndex || cx == null || cy == null) return <g key={index} />
    return <circle key={index} cx={cx} cy={cy} fill="white" r={4} stroke="#f97316" strokeWidth={2} />
  }
}

function ComparisonTooltip({
  currentLabel,
  historicalLabel,
  label,
  payload,
}: {
  currentLabel: string
  historicalLabel: string
  label?: string
  payload?: Array<{ dataKey: string; value: number | null }>
}) {
  if (!payload?.length) return null
  const currentEntry = payload.find((p) => p.dataKey === 'current')
  const historicalEntry = payload.find((p) => p.dataKey === 'historical')
  if (currentEntry?.value == null && historicalEntry?.value == null) return null

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-white shadow-lg">
      <div className="mb-2 text-sm font-semibold">Total Spending by {label}</div>
      {currentEntry?.value != null && (
        <div className="flex items-center gap-2 text-sm">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500" />
          <span className="text-neutral-300">{currentLabel}:</span>
          <span className="ml-auto tabular-nums font-semibold">{formatCurrency(currentEntry.value)}</span>
        </div>
      )}
      {historicalEntry?.value != null && (
        <div className="flex items-center gap-2 text-sm">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-neutral-400" />
          <span className="text-neutral-300">{historicalLabel}:</span>
          <span className="ml-auto tabular-nums font-semibold">{formatCurrency(historicalEntry.value)}</span>
        </div>
      )}
    </div>
  )
}
