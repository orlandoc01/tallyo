import { AreaChart as AreaChartIcon, LineChart as LineChartIcon } from 'lucide-react'
import { useState } from 'react'
import { Area, AreaChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MouseHandlerDataParam, TooltipContentProps, TooltipPayloadEntry, TooltipValueType } from 'recharts'
import { SegmentedControl } from '../common/SegmentedControl'
import { displayAmount } from './amountDisplay'
import { formatCurrency, formatCurrencyCompact, formatSignedCurrency } from '../../utils/currency'
import type { AssetClassifier, ClassifierHistoryPoint, LiabilityCategory, LiabilityHistoryPoint, NetWorthPoint, NetWorthRange } from '../../types/graphql'

const ranges: { id: NetWorthRange; label: string }[] = [
  { id: 'ONE_MONTH', label: '1M' },
  { id: 'THREE_MONTH', label: '3M' },
  { id: 'YTD', label: 'YTD' },
  { id: 'ONE_YEAR', label: '1Y' },
  { id: 'ALL', label: 'All' },
]

function NetWorthRangeSelector({ range, onChange }: { range: NetWorthRange; onChange: (range: NetWorthRange) => void }) {
  return <SegmentedControl ariaLabel="Net worth range" onChange={onChange} options={ranges.map((item) => ({ value: item.id, label: item.label }))} size="sm" value={range} />
}

type ChartView = 'NET_WORTH' | 'HISTORICAL_ALLOCATION'

type AllocationRow = { date: string } & Record<string, string | number>

const classifierColors: Record<AssetClassifier, string> = {
  CASH: '#10b981',
  PUBLIC: '#3b82f6',
  COMPANY_EQUITY: '#8b5cf6',
  CRYPTOCURRENCY: '#f59e0b',
  STABLECOIN: '#06b6d4',
  REAL_ESTATE: '#ec4899',
}

const liabilityColors: Record<LiabilityCategory, string> = {
  CARD: '#f97316',
  MORTGAGE: '#6366f1',
  LOAN: '#ef4444',
  OTHER: '#6b7280',
}

export function NetWorthChart({ points, classifierSeries = [], liabilitySeries = [], range, onRangeChange, positive, asOfDate, amountsHidden = false, netWorthUSD }: { points: NetWorthPoint[]; classifierSeries?: ClassifierHistoryPoint[]; liabilitySeries?: LiabilityHistoryPoint[]; range: NetWorthRange; onRangeChange: (range: NetWorthRange) => void; positive: boolean; asOfDate?: string | null; amountsHidden?: boolean; netWorthUSD?: number }) {
  const [chartView, setChartView] = useState<ChartView>('NET_WORTH')
  const [hoveredDate, setHoveredDate] = useState<string | null>(null)
  const stroke = positive ? '#059669' : '#dc2626'
  const assetConfigs = uniqueClassifierSeries(classifierSeries)
  const liabilityConfigs = uniqueLiabilitySeries(liabilitySeries)
  const allocationData = allocationRows(points, classifierSeries, liabilitySeries)
  const fallbackPoint = points[points.length - 1]
  const displayedPoint = (hoveredDate ? points.find((point) => point.date === hoveredDate) : undefined) ?? fallbackPoint
  const displayedValue = displayedPoint?.netWorthUSD ?? netWorthUSD
  const displayedDate = displayedPoint?.date ?? asOfDate

  function handleChartMouseMove(state: MouseHandlerDataParam) {
    const nextDate = hoveredDateFromState(state)
    setHoveredDate((current) => current === nextDate ? current : nextDate)
  }

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm lg:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-neutral-500">Wealth history</h2>
          {displayedValue !== undefined ? <p className="mt-2 text-4xl font-bold tracking-tight text-neutral-950 dark:text-neutral-100">{displayAmount(amountsHidden, formatCurrency(displayedValue))}</p> : null}
          {displayedDate ? <p className="mt-1 text-xs text-neutral-500">{displayedDate}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <NetWorthRangeSelector onChange={onRangeChange} range={range} />
          <SegmentedControl
            ariaLabel="Net worth chart view"
            onChange={setChartView}
            options={[
              { value: 'NET_WORTH', label: <LineChartIcon className="h-4 w-4" />, ariaLabel: 'Net worth chart', title: 'Net Worth Chart' },
              { value: 'HISTORICAL_ALLOCATION', label: <AreaChartIcon className="h-4 w-4" />, ariaLabel: 'Historical asset allocation chart', title: 'Historical Asset Allocation Chart' },
            ]}
            size="sm"
            value={chartView}
          />
        </div>
      </div>
      <div className="h-80">
        <ResponsiveContainer height="100%" width="100%">
          {chartView === 'NET_WORTH' ? (
            <AreaChart data={points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} onMouseLeave={() => setHoveredDate(null)} onMouseMove={handleChartMouseMove}>
              <defs>
                <linearGradient id="netWorthFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
              <YAxis tickFormatter={(value) => displayAmount(amountsHidden, formatCurrencyCompact(Number(value)))} tick={{ fontSize: 11 }} tickLine={false} width={54} />
              <Tooltip content={(props) => <NetWorthTooltip {...props} amountsHidden={amountsHidden} />} />
              <Area dataKey="netWorthUSD" fill="url(#netWorthFill)" stroke={stroke} strokeWidth={3} type="monotone" />
            </AreaChart>
          ) : (
            <AreaChart data={allocationData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} onMouseLeave={() => setHoveredDate(null)} onMouseMove={handleChartMouseMove}>
              <defs>
                {assetConfigs.map((item) => (
                  <linearGradient id={`allocationFill-${item.key}`} key={item.key} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={item.color} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={item.color} stopOpacity={0.04} />
                  </linearGradient>
                ))}
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
              <YAxis domain={['dataMin', 'dataMax']} tickFormatter={(value) => displayAmount(amountsHidden, formatCurrencyCompact(Number(value)))} tick={{ fontSize: 11 }} tickLine={false} width={54} />
              <Tooltip content={(props) => <AllocationTooltip {...props} amountsHidden={amountsHidden} />} />
              {assetConfigs.map((item) => (
                <Area dataKey={item.label} fill={`url(#allocationFill-${item.key})`} key={item.key} stroke={item.color} strokeWidth={2} type="monotone" />
              ))}
              {liabilityConfigs.map((item) => (
                <Line dataKey={item.label} dot={false} key={item.key} stroke={item.color} strokeWidth={2} type="monotone" />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  )
}

function NetWorthTooltip({ active, payload, amountsHidden }: TooltipContentProps & { amountsHidden: boolean }) {
  if (!active || !payload?.length) {
    return null
  }

  const point = payload[0]?.payload as NetWorthPoint | undefined
  if (!point) return null

  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-sm">
      <div className="space-y-1 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-neutral-700">Assets</span>
          <span className="font-semibold text-emerald-700">{displayAmount(amountsHidden, formatCurrency(point.totalAssetsUSD))}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-neutral-700">Liabilities</span>
          <span className="font-semibold text-red-700">{displayAmount(amountsHidden, formatSignedCurrency(-Math.abs(point.totalLiabilitiesUSD)))}</span>
        </div>
      </div>
    </div>
  )
}

function AllocationTooltip({ active, payload, label, amountsHidden }: TooltipContentProps & { amountsHidden: boolean }) {
  if (!active || !payload?.length) {
    return null
  }

  const sortedPayload: TooltipPayloadEntry[] = [...payload].sort((left, right) => tooltipItemValue(right.value) - tooltipItemValue(left.value))

  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-sm">
      {label ? <p className="mb-2 text-xs text-neutral-500">{label}</p> : null}
      <div className="space-y-1">
        {sortedPayload.map((item) => (
          <div className="flex items-center justify-between gap-3 text-sm" key={String(item.dataKey ?? item.name)}>
            <span className="text-neutral-700" style={{ color: item.color ?? undefined }}>
              {item.name}
            </span>
            <span className="font-medium text-neutral-900">{displayAmount(amountsHidden, formatSignedCurrency(tooltipItemValue(item.value)))}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function tooltipItemValue(value: TooltipValueType | undefined) {
  if (Array.isArray(value)) {
    return Number(value[0] ?? 0)
  }
  return Number(value ?? 0)
}

function allocationRows(points: NetWorthPoint[], classifierSeries: ClassifierHistoryPoint[], liabilitySeries: LiabilityHistoryPoint[]): AllocationRow[] {
  const byDate = new Map<string, AllocationRow>()
  for (const point of points) {
    byDate.set(point.date, { date: point.date })
  }
  for (const point of classifierSeries) {
    const row = byDate.get(point.date) ?? { date: point.date }
    row[point.label] = point.valueUSD
    byDate.set(point.date, row)
  }
  for (const point of liabilitySeries) {
    const row = byDate.get(point.date) ?? { date: point.date }
    row[point.label] = point.valueUSD
    byDate.set(point.date, row)
  }
  return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date))
}

function hoveredDateFromState(state: unknown) {
  if (!state || typeof state !== 'object' || !('activeLabel' in state)) return null
  const { activeLabel } = state
  return typeof activeLabel === 'string' ? activeLabel : null
}

function uniqueClassifierSeries(points: ClassifierHistoryPoint[]) {
  const seen = new Set<AssetClassifier>()
  return points.flatMap((point) => {
    if (seen.has(point.classifier)) return []
    seen.add(point.classifier)
    return [{ key: point.classifier, label: point.label, color: classifierColors[point.classifier] }]
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
