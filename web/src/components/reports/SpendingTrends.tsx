import clsx from 'clsx'
import { useMemo, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import type { CategorySpending, SpendingPeriod } from '../../types/domain'
import { useIsMobile } from '../../hooks/useIsMobile'
import { chartTheme, mobileTooltipProps, spendingChartColor } from '../../utils/chartStyles'
import { formatCurrency, formatCurrencyCompact } from '../../utils/currency'
import { type GroupBy, aggregateByGroup, topNWithEverythingElse } from '../../utils/spending'
import { Button } from '../common/Button'
import { shortPeriodLabel } from './cashFlowStats'
import { ActiveTooltipLabelTracker, ChartTooltipBox, ChartTooltipRow, ChartTooltipTitle } from '../common/ChartTooltip'
import type { SpendingCategoryFocus } from './SpendingBreakdown'

const SERIES_OPACITY = 0.85
const DIMMED_OPACITY = 0.3

interface StackedDataPoint {
  periodLabel: string
  total: number
  [seriesName: string]: number | string
}

interface ChartItem {
  id: string
  name: string
  emoji: string
  color: string
  categoryIds: string[]
}

export function SpendingTrends({ focusedCategoryId = null, groupBy, onCategoryFocusChange, periods }: {
  focusedCategoryId?: string | null
  groupBy?: GroupBy
  onCategoryFocusChange?: (focus: SpendingCategoryFocus | null) => void
  periods: SpendingPeriod[]
}) {
  const isMobile = useIsMobile()
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null)
  const chartItems = useMemo(() => trendsChartItems(periods, groupBy), [groupBy, periods])
  const data = useMemo(() => stackedData(periods, chartItems, groupBy), [periods, chartItems, groupBy])

  if (periods.length === 0) {
    return <p className="p-8 text-[13px] text-text-muted">No trends data available.</p>
  }

  const focused = chartItems.find((item) => item.id === focusedCategoryId)
  const opacityFor = (item: ChartItem, label: string) =>
    (focusedCategoryId && item.id !== focusedCategoryId) || (hoveredLabel && hoveredLabel !== label) ? DIMMED_OPACITY : SERIES_OPACITY
  const toggleFocus = onCategoryFocusChange ? (item: ChartItem) => onCategoryFocusChange(focusedCategoryId === item.id ? null : { id: item.id, categoryIds: item.categoryIds }) : undefined

  return (
    <div className="mt-[30px] lg:mt-7">
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_190px] lg:gap-6">
        <div className="h-[180px] lg:h-[280px]" ref={containerRef}>
          <ResponsiveContainer height="100%" width="100%">
            <BarChart barCategoryGap="20%" data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
              <ActiveTooltipLabelTracker onChange={setHoveredLabel} />
              <CartesianGrid stroke={chartTheme.grid.stroke} strokeDasharray={chartTheme.grid.strokeDasharray} vertical={false} />
              <XAxis axisLine={false} dataKey="periodLabel" tick={chartTheme.axisTickX} tickFormatter={isMobile ? shortPeriodLabel : undefined} tickLine={false} tickMargin={10} />
              <YAxis axisLine={false} domain={[0, 'auto']} hide={isMobile} tick={chartTheme.axisTick} tickCount={5} tickFormatter={(value: number) => formatCurrencyCompact(value)} tickLine={false} width={52} />
              <ReferenceLine stroke={chartTheme.baseline.stroke} y={0} />
              <Tooltip {...mobileTooltipProps(isMobile)} content={(props) => <TrendsTooltip {...props} chartItems={chartItems} clampWidth={isMobile ? containerRef.current?.clientWidth : undefined} />} cursor={{ fill: 'transparent' }} />
              {chartItems.map((item) => (
                <Bar dataKey={item.name} fill={item.color} isAnimationActive={false} key={item.id} maxBarSize={100} stackId="spending">
                  {data.map((point) => <Cell fillOpacity={opacityFor(item, point.periodLabel)} key={point.periodLabel} />)}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className={clsx('grid gap-x-4 gap-y-2 text-xs lg:flex lg:flex-col lg:gap-2.5 lg:text-[13px]', isMobile && 'grid-cols-2')}>
          {chartItems.map((item) => (
            <button
              aria-pressed={toggleFocus ? focusedCategoryId === item.id : undefined}
              className={clsx('flex min-w-0 items-center gap-2 text-left transition-colors', toggleFocus ? 'cursor-pointer hover:text-text-1' : 'cursor-default', focusedCategoryId === item.id ? 'text-text-1' : 'text-text-3')}
              key={item.id}
              onClick={toggleFocus ? () => toggleFocus(item) : undefined}
              type="button"
            >
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="truncate">{item.emoji} {item.name}</span>
            </button>
          ))}
        </div>
      </div>
      {focused ? (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-text-3">
          <span>Focused on {focused.emoji} {focused.name}.</span>
          <Button onClick={() => onCategoryFocusChange?.(null)} size="sm" variant="ghost">Clear focus</Button>
        </div>
      ) : null}
    </div>
  )
}

function TrendsTooltip({ active, chartItems, clampWidth, coordinate, payload }: TooltipContentProps & { chartItems: ChartItem[]; clampWidth?: number }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload as StackedDataPoint | undefined
  if (!point) return null
  const rows = chartItems
    .map((item) => ({ item, value: Number(point[item.name] ?? 0) }))
    .filter((row) => row.value > 0)

  return (
    <ChartTooltipBox clampWidth={clampWidth} coordinate={coordinate}>
      <ChartTooltipTitle>{point.periodLabel}</ChartTooltipTitle>
      <p className="text-xs font-semibold">{formatCurrency(point.total)}</p>
      {rows.map(({ item, value }) => <ChartTooltipRow color={item.color} key={item.id} label={`${item.emoji} ${item.name}`} value={formatCurrency(value)} />)}
    </ChartTooltipBox>
  )
}

// The legend's "Everything else" stands for every category outside the top
// five (or, by group, every category of the remaining groups).
function trendsChartItems(periods: SpendingPeriod[], groupBy?: GroupBy): ChartItem[] {
  const categories = aggregateCategories(periods)
  const { visible, everythingElse } = topNWithEverythingElse(spendingSlices(categories, groupBy), 5)
  const shownIds = new Set(visible.filter((item) => item !== everythingElse).map((item) => item.id))
  const memberIds = (item: { id: string }) => groupBy === 'group'
    ? categories.filter((entry) => entry.category.groupName === item.id).map((entry) => entry.category.id)
    : [item.id]
  const remainderIds = categories.filter((entry) => !shownIds.has(groupBy === 'group' ? entry.category.groupName : entry.category.id)).map((entry) => entry.category.id)
  return visible.map((item) => ({ id: item.id, name: item.name, emoji: item.emoji, color: spendingChartColor(item.id), categoryIds: item === everythingElse ? remainderIds : memberIds(item) }))
}

function stackedData(periods: SpendingPeriod[], chartItems: ChartItem[], groupBy?: GroupBy): StackedDataPoint[] {
  const known = new Map(chartItems.map((item) => [item.id, item.name]))
  return periods.map((period) => {
    const point: StackedDataPoint = { periodLabel: period.periodLabel, total: period.total }
    for (const item of chartItems) point[item.name] = 0
    for (const slice of spendingSlices(period.categories, groupBy)) {
      const name = known.get(slice.id) ?? 'Everything else'
      point[name] = Number(point[name] ?? 0) + Math.max(0, slice.total)
    }
    return point
  })
}

function aggregateCategories(periods: SpendingPeriod[]): CategorySpending[] {
  const byId = new Map<string, CategorySpending>()
  for (const item of periods.flatMap((period) => period.categories)) {
    const existing = byId.get(item.category.id)
    if (existing) {
      existing.total += item.total
      existing.transactionCount += item.transactionCount
      existing.percentOfTotal += item.percentOfTotal
    } else {
      byId.set(item.category.id, { ...item })
    }
  }
  return [...byId.values()].sort((a, b) => b.total - a.total)
}

function spendingSlices(categories: CategorySpending[], groupBy?: GroupBy) {
  return groupBy === 'group'
    ? aggregateByGroup(categories)
    : categories.map((item) => ({ id: item.category.id, name: item.category.name, emoji: item.category.emoji, total: item.total, transactionCount: item.transactionCount, percentOfTotal: item.percentOfTotal }))
}
