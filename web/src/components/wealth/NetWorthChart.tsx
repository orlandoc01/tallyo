import { AreaChart as AreaChartIcon, LineChart as LineChartIcon } from 'lucide-react'
import { useState } from 'react'
import { Area, AreaChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Payload } from 'recharts/types/component/DefaultTooltipContent'
import type { TooltipProps } from 'recharts/types/component/Tooltip'
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

type ChartView = 'NET_WORTH' | 'HISTORICAL_ALLOCATION'

type AllocationRow = { date: string } & Record<string, string | number>

type TooltipValue = string | number | Array<string | number>

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

  function handleChartMouseMove(state: unknown) {
    const nextDate = hoveredDateFromState(state)
    setHoveredDate((current) => current === nextDate ? current : nextDate)
  }

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm lg:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-neutral-500">Wealth History</h2>
          {displayedValue !== undefined ? <p className="mt-2 text-4xl font-bold tracking-tight text-neutral-950 dark:text-neutral-100">{displayAmount(amountsHidden, formatCurrency(displayedValue))}</p> : null}
          {displayedDate ? <p className="mt-1 text-xs text-neutral-500">{displayedDate}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex rounded-full bg-neutral-100 p-1">
            {ranges.map((item) => (
              <button className={`rounded-full px-3 py-1 text-xs font-semibold transition ${range === item.id ? 'bg-white text-brand-700 shadow-sm' : 'text-neutral-500'}`} key={item.id} onClick={() => onRangeChange(item.id)} type="button">
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-full bg-neutral-100 p-1">
            <button aria-label="Net worth chart" className={`rounded-full p-2 transition ${chartView === 'NET_WORTH' ? 'bg-white text-brand-700 shadow-sm ring-1 ring-brand-200' : 'text-neutral-500 hover:text-neutral-800'}`} onClick={() => setChartView('NET_WORTH')} title="Net Worth Chart" type="button">
              <LineChartIcon className="h-4 w-4" />
            </button>
            <button aria-label="Historical asset allocation chart" className={`rounded-full p-2 transition ${chartView === 'HISTORICAL_ALLOCATION' ? 'bg-white text-brand-700 shadow-sm ring-1 ring-brand-200' : 'text-neutral-500 hover:text-neutral-800'}`} onClick={() => setChartView('HISTORICAL_ALLOCATION')} title="Historical Asset Allocation Chart" type="button">
              <AreaChartIcon className="h-4 w-4" />
            </button>
          </div>
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
              <Tooltip content={<NetWorthTooltip amountsHidden={amountsHidden} />} />
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
              <Tooltip content={<AllocationTooltip amountsHidden={amountsHidden} />} />
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

function NetWorthTooltip({ active, payload, amountsHidden }: TooltipProps<number, string> & { amountsHidden: boolean }) {
  if (!active || !payload?.length) {
    return null
  }

  const point = payload[0]?.payload as NetWorthPoint | undefined
  if (!point) return null

  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-sm">
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

function AllocationTooltip({ active, payload, label, amountsHidden }: TooltipProps<TooltipValue, string> & { amountsHidden: boolean }) {
  if (!active || !payload?.length) {
    return null
  }

  const sortedPayload: Array<Payload<TooltipValue, string>> = [...payload].sort((left, right) => tooltipItemValue(right.value) - tooltipItemValue(left.value))

  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-sm">
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

function tooltipItemValue(value: TooltipValue | undefined) {
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
