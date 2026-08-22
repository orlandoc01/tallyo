/* eslint-disable max-lines -- pre-existing overage; decompose before growing (fallow audit target) */
import type { ReactElement, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { Granularity } from '../../types/graphql'
import type { CategorySpending, SpendingPeriod } from '../../types/domain'
import { chartMarkOpacity, chartOpacityForFocus, spendingChartColor } from '../../utils/chartStyles'
import { formatCurrency, formatCurrencyCompact } from '../../utils/currency'
import { useIsMobile } from '../../hooks/useIsMobile'
import { Card } from '../common/FormControls'
import { type GroupBy, aggregateByGroup, topNWithEverythingElse } from '../../utils/spending'
import { reportChartAxes } from './chartAxes'
import { GranularitySelector } from './DateRangeSelector'
import { ChartViewTogglePill } from './ChartViewTogglePill'

export type TrendsChartView = 'stacked' | 'line'

interface StackedDataPoint {
  periodLabel: string
  total: number
  [categoryName: string]: number | string
}

interface ChartItem {
  id: string
  name: string
  emoji: string
  color: string
}

export function SpendingTrends({
  focusedCategoryId,
  granularity = 'MONTHLY',
  groupBy,
  onCategoryFocusChange,
  onGranularityChange,
  onViewChange,
  periods,
  view: viewProp,
}: {
  focusedCategoryId?: string | null
  granularity?: Granularity
  groupBy?: GroupBy
  onCategoryFocusChange?: (categoryId: string | null) => void
  onGranularityChange?: (granularity: Granularity) => void
  onViewChange?: (view: TrendsChartView) => void
  periods: SpendingPeriod[]
  view?: TrendsChartView
}) {
  const [internalView, setInternalView] = useState<TrendsChartView>('stacked')
  const view = viewProp ?? internalView
  function setView(v: TrendsChartView) { setInternalView(v); onViewChange?.(v) }

  const chartItems = useMemo((): ChartItem[] => {
    const { visible } = topNWithEverythingElse(spendingSlices(aggregateCategories(periods), groupBy), 5)
    return visible.map((item) => ({
      id: item.id,
      name: item.name,
      emoji: item.emoji,
      color: spendingChartColor(item.id),
    }))
  }, [groupBy, periods])

  const stackedData = useMemo((): StackedDataPoint[] => {
    return periods.map((p) => {
      const point: StackedDataPoint = { periodLabel: p.periodLabel, total: p.total }
      for (const item of chartItems) {
        point[item.name] = 0
      }

      for (const slice of spendingSlices(p.categories, groupBy)) {
        const chartItem = chartItems.find((item) => item.id === slice.id)
        if (chartItem) {
          point[chartItem.name] = Math.max(0, slice.total)
        } else {
          point['Everything else'] = (point['Everything else'] as number || 0) + Math.max(0, slice.total)
        }
      }

      return point
    })
  }, [periods, chartItems, groupBy])

  if (periods.length === 0) {
    return <div className="p-8 text-sm text-neutral-500">No trends data available.</div>
  }

  function toggleFocus(categoryId: string) {
    onCategoryFocusChange?.(focusedCategoryId === categoryId ? null : categoryId)
  }

  return (
    <Card as="section" overflow="visible">
      <div className="hidden flex-nowrap items-center justify-end gap-2 border-b border-neutral-100 p-5 lg:flex lg:flex-wrap">
        <div className="flex flex-nowrap items-center gap-2 lg:w-auto lg:gap-3">
          {onGranularityChange ? (
            <GranularitySelector
              buttonClassName="rounded-xl px-2 py-2 text-xs font-semibold"
              className="flex rounded-2xl bg-neutral-100 p-1"
              granularity={granularity}
              labelVariant="long"
              onChange={onGranularityChange}
            />
          ) : null}
          <ChartViewTogglePill
            options={[{ value: 'stacked', label: 'Stacked' }, { value: 'line', label: 'Line' }]}
            size="responsive"
            value={view}
            onChange={setView}
          />
          {focusedCategoryId ? (
            <button
              className="rounded-2xl border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:text-brand-900"
              onClick={() => onCategoryFocusChange?.(null)}
              type="button"
            >
              Clear focus
            </button>
          ) : null}
        </div>
      </div>

      {focusedCategoryId ? (
        <FocusedTrendChart
          chartItems={chartItems}
          focusedCategoryId={focusedCategoryId}
          groupBy={groupBy}
          periods={periods}
          view={view}
        />
      ) : view === 'stacked' ? (
        <StackedBarChart
          chartItems={chartItems}
          data={stackedData}
          onLegendClick={onCategoryFocusChange ? toggleFocus : undefined}
        />
      ) : (
        <LineTrendsChartView
          chartItems={chartItems.filter((item) => item.name !== 'Everything else').slice(0, 5)}
          data={stackedData}
          onLegendClick={onCategoryFocusChange ? toggleFocus : undefined}
        />
      )}

      {focusedCategoryId ? (
        <div className="border-t border-neutral-100 p-4 text-sm text-neutral-600">
          Focused on {chartItems.find((ci) => ci.id === focusedCategoryId)?.emoji} {chartItems.find((ci) => ci.id === focusedCategoryId)?.name}.{' '}
          <button className="font-semibold text-brand-700 hover:text-brand-900" onClick={() => onCategoryFocusChange?.(null)} type="button">
            Clear focus
          </button>
        </div>
      ) : null}
    </Card>
  )
}

interface TrendsAxisProps {
  yAxisWidth: number
  yAxisFormatter: (value: number) => string
}

// Shared responsive shell for every trends chart: mobile charts shrink,
// scroll horizontally past 3 points, and compact their y-axis labels.
function TrendsChartFrame({
  pointCount,
  footer,
  children,
}: {
  pointCount: number
  footer?: ReactNode
  children: (axis: TrendsAxisProps) => ReactElement
}) {
  const isMobile = useIsMobile()
  const scrollable = isMobile && pointCount > 3
  const chartHeight = isMobile ? 200 : 320

  return (
    <div className="p-5">
      <div className={isMobile ? 'overflow-x-auto trends-chart' : 'trends-chart'}>
        <div style={{ minWidth: scrollable ? `${pointCount * 80}px` : undefined, height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            {children({ yAxisWidth: isMobile ? 56 : 88, yAxisFormatter: isMobile ? formatCurrencyCompact : formatCurrency })}
          </ResponsiveContainer>
        </div>
      </div>
      {footer}
    </div>
  )
}

function ChartLegend({
  chartItems,
  onLegendClick,
}: {
  chartItems: ChartItem[]
  onLegendClick?: (categoryId: string) => void
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-3 px-2">
      {chartItems.map((item) => (
        <button
          className={`flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-sm transition-colors ${onLegendClick ? 'cursor-pointer hover:bg-neutral-100' : 'cursor-default'}`}
          key={item.id}
          onClick={onLegendClick ? () => onLegendClick(item.id) : undefined}
          type="button"
        >
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
          {item.emoji} {item.name}
        </button>
      ))}
    </div>
  )
}

function StackedBarChart({
  chartItems,
  data,
  onLegendClick,
}: {
  chartItems: ChartItem[]
  data: StackedDataPoint[]
  onLegendClick?: (categoryId: string) => void
}) {
  return (
    <TrendsChartFrame footer={<ChartLegend chartItems={chartItems} onLegendClick={onLegendClick} />} pointCount={data.length}>
      {(axis) => (
        <BarChart data={data}>
          {reportChartAxes({ dataKey: 'periodLabel', ...axis })}
          <Tooltip content={<StackedTooltip chartItems={chartItems} />} cursor={{ fill: 'transparent' }} />
          {chartItems.map((item) => (
            <Bar
              activeBar={{ fillOpacity: chartMarkOpacity.active }}
              dataKey={item.name}
              fill={item.color}
              fillOpacity={chartOpacityForFocus(false)}
              key={item.id}
              stackId="spending"
            />
          ))}
        </BarChart>
      )}
    </TrendsChartFrame>
  )
}

function FocusedTrendChart({
  chartItems,
  focusedCategoryId,
  groupBy,
  periods,
  view,
}: {
  chartItems: ChartItem[]
  focusedCategoryId: string
  groupBy?: GroupBy
  periods: SpendingPeriod[]
  view: TrendsChartView
}) {
  const chartItem = chartItems.find((ci) => ci.id === focusedCategoryId)
  if (!chartItem) return null

  const data = focusedTrendData(periods, focusedCategoryId, groupBy)
  const tooltip = (
    <Tooltip formatter={(value) => formatCurrency(Number(value))} labelFormatter={(label) => `${chartItem.emoji} ${chartItem.name} — ${label}`} />
  )
  const caption = (
    <div className="mt-2 text-center text-sm text-neutral-500">
      {chartItem.emoji} {chartItem.name}
    </div>
  )

  return (
    <TrendsChartFrame footer={caption} pointCount={periods.length}>
      {(axis) =>
        view === 'stacked' ? (
          <BarChart data={data}>
            {reportChartAxes({ dataKey: 'periodLabel', ...axis })}
            {tooltip}
            <Bar activeBar={{ fillOpacity: chartMarkOpacity.active }} dataKey="value" fill={chartItem.color} fillOpacity={chartOpacityForFocus(true)} radius={[4, 4, 0, 0]} />
          </BarChart>
        ) : (
          <LineChart data={data}>
            {reportChartAxes({ dataKey: 'periodLabel', ...axis })}
            {tooltip}
            <Line activeDot={{ opacity: chartMarkOpacity.active, r: 4 }} dataKey="value" dot={{ opacity: chartOpacityForFocus(true), r: 3 }} name={`${chartItem.emoji} ${chartItem.name}`} stroke={chartItem.color} strokeOpacity={chartOpacityForFocus(true)} strokeWidth={3} type="monotone" />
          </LineChart>
        )
      }
    </TrendsChartFrame>
  )
}

function LineTrendsChartView({
  chartItems,
  data,
  onLegendClick,
}: {
  chartItems: ChartItem[]
  data: StackedDataPoint[]
  onLegendClick?: (categoryId: string) => void
}) {
  return (
    <TrendsChartFrame footer={<ChartLegend chartItems={chartItems} onLegendClick={onLegendClick} />} pointCount={data.length}>
      {(axis) => (
        <LineChart data={data}>
          {reportChartAxes({ dataKey: 'periodLabel', ...axis })}
          <Tooltip formatter={(value, name) => [formatCurrency(Number(value)), name]} />
          {chartItems.map((item) => (
            <Line
              activeDot={{ opacity: chartMarkOpacity.active, r: 4 }}
              dataKey={item.name}
              dot={{ opacity: chartOpacityForFocus(false), r: 3 }}
              key={item.id}
              name={`${item.emoji} ${item.name}`}
              stroke={item.color}
              strokeOpacity={chartOpacityForFocus(false)}
              strokeWidth={3}
              type="monotone"
            />
          ))}
        </LineChart>
      )}
    </TrendsChartFrame>
  )
}

function focusedTrendData(periods: SpendingPeriod[], focusedCategoryId: string, groupBy?: GroupBy) {
  return periods.map((p) => {
    const slice = spendingSlices(p.categories, groupBy).find((item) => item.id === focusedCategoryId)
    return { periodLabel: p.periodLabel, value: slice?.total ?? 0 }
  })
}

function StackedTooltip({
  chartItems,
  payload,
}: {
  chartItems: ChartItem[]
  payload?: Array<{ name: string; value: number; color: string; payload?: { periodLabel?: string } }>
}) {
  if (!payload?.length) return null

  const periodLabel = payload[0]?.payload?.periodLabel
  const total = payload.reduce((sum, entry) => sum + (entry.value ?? 0), 0)

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-lg">
      <div className="mb-2 text-sm font-semibold">{periodLabel}</div>
      <div className="mb-2 font-medium">{formatCurrency(total)}</div>
      <div className="space-y-1">
        {payload
          .filter((entry) => entry.value > 0)
          .sort(compareTooltipEntries)
          .map((entry) => {
            const chartItem = chartItems.find((ci) => ci.name === entry.name)

            return (
              <div className="flex items-center gap-2 text-sm" key={entry.name}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-neutral-600">{chartItem ? `${chartItem.emoji} ${chartItem.name}` : entry.name}</span>
                <span className="ml-auto tabular-nums">{formatCurrency(entry.value)}</span>
              </div>
            )
          })}
      </div>
    </div>
  )
}

function aggregateCategories(periods: SpendingPeriod[]): CategorySpending[] {
  const categoriesById = new Map<string, CategorySpending>()

  for (const item of periods.flatMap((period) => period.categories)) {
    const existing = categoriesById.get(item.category.id)
    if (existing) {
      existing.total += item.total
      existing.transactionCount += item.transactionCount
      existing.percentOfTotal += item.percentOfTotal
    } else {
      categoriesById.set(item.category.id, { ...item })
    }
  }

  return [...categoriesById.values()].sort((a, b) => b.total - a.total)
}

function spendingSlices(categories: CategorySpending[], groupBy?: GroupBy) {
  return groupBy === 'group'
    ? aggregateByGroup(categories)
    : categories.map((item) => ({
        id: item.category.id,
        name: item.category.name,
        emoji: item.category.emoji,
        total: item.total,
        transactionCount: item.transactionCount,
        percentOfTotal: item.percentOfTotal,
      }))
}

function compareTooltipEntries(a: { name: string; value: number }, b: { name: string; value: number }) {
  if (a.name === 'Everything else') return 1
  if (b.name === 'Everything else') return -1
  return b.value - a.value
}
