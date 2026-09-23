import { useRef, type KeyboardEvent } from 'react'
import { Area, AreaChart, CartesianGrid, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps, TooltipPayloadEntry, TooltipValueType } from 'recharts'
import { displayAmount } from './amountDisplay'
import { useIsMobile } from '../../hooks/useIsMobile'
import { CHART_CURSOR, CHART_SURFACE, assetClassColors, chartTheme, liabilityColors, mobileTooltipProps } from '../../utils/chartStyles'
import { ActiveTooltipLabelTracker, ChartTooltipBox, ChartTooltipTitle } from '../common/ChartTooltip'
import { formatCurrency, formatCurrencyCompact, formatSignedCurrency } from '../../utils/currency'
import { chartDateTick } from '../../utils/dates'
import type { AssetClassifier, ClassifierHistoryPoint, LiabilityCategory, LiabilityHistoryPoint, NetWorthPoint } from '../../types/graphql'

export type ChartView = 'NET_WORTH' | 'HISTORICAL_ALLOCATION'

const CHART_KEYBOARD_HELP = 'Use the arrow keys to move between dates and press Enter to focus or clear a date.'
const CHART_LINE = 'rgb(var(--chart-line))'

type AllocationRow = { date: string } & Record<string, string | number>

export function NetWorthChart({ points, classifierSeries = [], liabilitySeries = [], view, asOfDate, amountsHidden = false, focusedDate, hoveredDate, onFocusDate, onHoverDate }: {
  points: NetWorthPoint[]
  classifierSeries?: ClassifierHistoryPoint[]
  liabilitySeries?: LiabilityHistoryPoint[]
  view: ChartView
  asOfDate?: string | null
  amountsHidden?: boolean
  focusedDate?: string
  hoveredDate: string | null
  onFocusDate?: (date: string | null) => void
  onHoverDate: (date: string | null) => void
}) {
  const isMobile = useIsMobile()
  const containerRef = useRef<HTMLDivElement>(null)
  const assetConfigs = uniqueClassifierSeries(classifierSeries)
  const liabilityConfigs = uniqueLiabilitySeries(liabilitySeries)
  const allocationData = allocationRows(points, classifierSeries, liabilitySeries)
  const focusedPoint = focusedDate ? points.find((point) => point.date === focusedDate) : undefined
  const lastDate = points[points.length - 1]?.date
  // Everything but the focused point recedes so it reads as the selection.
  const seriesOpacity = focusedDate ? 0.35 : 1
  const margin = { left: 0, right: isMobile ? 0 : 8, top: 8, bottom: 0 }
  const tickFormatter = (value: string) => displayAmount(amountsHidden, formatCurrencyCompact(Number(value)))
  const xAxis = <XAxis axisLine={false} dataKey="date" interval="preserveStartEnd" minTickGap={isMobile ? 32 : 64} tick={chartTheme.axisTick} tickFormatter={(value: string) => chartDateTick(value, { asOfDate, compact: isMobile, lastDate })} tickLine={false} tickMargin={10} />
  const tooltipProps = { cursor: CHART_CURSOR, ...mobileTooltipProps(isMobile) }
  const clampWidth = () => (isMobile ? containerRef.current?.clientWidth ?? 0 : undefined)


  function toggleFocus() {
    if (!onFocusDate) return
    if (focusedDate) {
      onFocusDate(null)
      return
    }
    if (hoveredDate) onFocusDate(hoveredDate)
  }

  // Recharts moves its active point with the arrow keys but never calls
  // onClick from the keyboard; Enter/Space are claimed here before Recharts
  // toggles its tooltip on the same key.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!onFocusDate || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    event.stopPropagation()
    toggleFocus()
  }

  return (
    <div className={onFocusDate ? 'h-40 cursor-pointer lg:h-60' : 'h-40 lg:h-60'} onKeyDownCapture={handleKeyDown} ref={containerRef}>
      <ResponsiveContainer height="100%" width="100%">
        {view === 'NET_WORTH' ? (
          <AreaChart data={points} desc={CHART_KEYBOARD_HELP} margin={margin} onClick={toggleFocus}>
            <ActiveTooltipLabelTracker onChange={onHoverDate} />
            <defs>
              <linearGradient id="netWorthFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={CHART_LINE} stopOpacity={0.45} />
                <stop offset="100%" stopColor={CHART_LINE} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={chartTheme.grid.stroke} strokeDasharray={chartTheme.grid.strokeDasharray} vertical={false} />
            {xAxis}
            <YAxis axisLine={false} domain={[0, 'auto']} hide={isMobile} tick={chartTheme.axisTick} tickCount={4} tickFormatter={tickFormatter} tickLine={false} width={46} />
            <ReferenceLine stroke={chartTheme.baseline.stroke} y={0} />
            <Tooltip {...tooltipProps} content={(props) => <NetWorthTooltip {...props} amountsHidden={amountsHidden} clampWidth={clampWidth()} />} />
            <Area isAnimationActive={false} activeDot={{ r: chartTheme.dot.r, fill: CHART_SURFACE, stroke: CHART_LINE, strokeWidth: chartTheme.dot.strokeWidth }} dataKey="netWorthUSD" fill="url(#netWorthFill)" fillOpacity={seriesOpacity} stroke={CHART_LINE} strokeOpacity={seriesOpacity} strokeWidth={chartTheme.line.strokeWidth} type="monotone" />
            {focusedPoint ? (
              <>
                <ReferenceLine stroke={CHART_LINE} strokeDasharray="4 4" x={focusedPoint.date} />
                <ReferenceDot fill={CHART_SURFACE} r={5} stroke={CHART_LINE} strokeWidth={2} x={focusedPoint.date} y={focusedPoint.netWorthUSD} />
              </>
            ) : null}
          </AreaChart>
        ) : (
          <AreaChart data={allocationData} desc={CHART_KEYBOARD_HELP} margin={margin} onClick={toggleFocus}>
            <ActiveTooltipLabelTracker onChange={onHoverDate} />
            <defs>
              {assetConfigs.map((item) => (
                <linearGradient id={`allocationFill-${item.key}`} key={item.key} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={item.color} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={item.color} stopOpacity={0.03} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={chartTheme.grid.stroke} strokeDasharray={chartTheme.grid.strokeDasharray} vertical={false} />
            {xAxis}
            <YAxis axisLine={false} domain={['auto', 'auto']} hide={isMobile} tick={chartTheme.axisTick} tickCount={4} tickFormatter={tickFormatter} tickLine={false} width={46} />
            <ReferenceLine stroke={chartTheme.baseline.stroke} y={0} />
            <Tooltip {...tooltipProps} content={(props) => <AllocationTooltip {...props} amountsHidden={amountsHidden} clampWidth={clampWidth()} />} />
            {assetConfigs.map((item) => (
              <Area isAnimationActive={false} dataKey={item.label} fill={`url(#allocationFill-${item.key})`} fillOpacity={seriesOpacity} key={item.key} stroke={item.color} strokeOpacity={seriesOpacity} strokeWidth={chartTheme.line.strokeWidth} type="monotone" />
            ))}
            {liabilityConfigs.map((item) => (
              <Line isAnimationActive={false} dataKey={item.label} dot={false} key={item.key} stroke={item.color} strokeOpacity={seriesOpacity} strokeWidth={chartTheme.line.strokeWidth} type="monotone" />
            ))}
            {focusedPoint ? <ReferenceLine stroke={chartTheme.baseline.stroke} strokeDasharray="4 4" x={focusedPoint.date} /> : null}
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

type ChartTooltipProps = TooltipContentProps & { amountsHidden: boolean; clampWidth?: number }

function NetWorthTooltip({ active, payload, amountsHidden, clampWidth, coordinate }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload as NetWorthPoint | undefined
  if (!point) return null

  return (
    <ChartTooltipBox clampWidth={clampWidth} coordinate={coordinate}>
      <p className="text-[13px] font-semibold">{displayAmount(amountsHidden, formatCurrency(point.netWorthUSD))}</p>
      <ChartTooltipTitle>{point.date}</ChartTooltipTitle>
    </ChartTooltipBox>
  )
}

function AllocationTooltip({ active, payload, label, amountsHidden, clampWidth, coordinate }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  const sortedPayload: TooltipPayloadEntry[] = [...payload].sort((left, right) => tooltipItemValue(right.value) - tooltipItemValue(left.value))

  return (
    <ChartTooltipBox clampWidth={clampWidth} coordinate={coordinate}>
      {sortedPayload.map((item) => (
        <div className="flex items-center justify-between gap-3 text-[13px]" key={String(item.dataKey ?? item.name)}>
          <span style={{ color: item.color ?? undefined }}>{item.name}</span>
          <span className="font-semibold">{displayAmount(amountsHidden, formatSignedCurrency(tooltipItemValue(item.value)))}</span>
        </div>
      ))}
      {label ? <ChartTooltipTitle>{String(label)}</ChartTooltipTitle> : null}
    </ChartTooltipBox>
  )
}

function tooltipItemValue(value: TooltipValueType | undefined) {
  if (Array.isArray(value)) return Number(value[0] ?? 0)
  return Number(value ?? 0)
}

function allocationRows(points: NetWorthPoint[], classifierSeries: ClassifierHistoryPoint[], liabilitySeries: LiabilityHistoryPoint[]): AllocationRow[] {
  const byDate = new Map<string, AllocationRow>()
  for (const point of points) {
    byDate.set(point.date, { date: point.date })
  }
  for (const point of [...classifierSeries, ...liabilitySeries]) {
    const row = byDate.get(point.date) ?? { date: point.date }
    row[point.label] = point.valueUSD
    byDate.set(point.date, row)
  }
  return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date))
}

function uniqueClassifierSeries(points: ClassifierHistoryPoint[]) {
  const seen = new Set<AssetClassifier>()
  return points.flatMap((point) => {
    if (seen.has(point.classifier)) return []
    seen.add(point.classifier)
    return [{ key: point.classifier, label: point.label, color: assetClassColors[point.classifier] }]
  })
}

function uniqueLiabilitySeries(points: LiabilityHistoryPoint[]) {
  const seen = new Set<LiabilityCategory>()
  return points.flatMap((point) => {
    if (seen.has(point.category)) return []
    seen.add(point.category)
    return [{ key: point.category, label: point.label, color: liabilityColors[point.category] }]
  })
}
