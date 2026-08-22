import { Tooltip } from 'recharts'
import { DonutChart } from '../common/DonutChart'
import { displayAmount } from '../wealth/amountDisplay'
import type { AnalysisSlice } from '../../types/graphql'
import { formatCurrency, formatCurrencyCompact } from '../../utils/currency'
import { analysisSliceColor } from './analysisSliceColor'

export function AnalysisPieChart({ slices, totalValueUSD, amountsHidden = false, selectedLabel, onSliceClick }: { slices: AnalysisSlice[]; totalValueUSD: number; amountsHidden?: boolean; selectedLabel?: string | null; onSliceClick?: (label: string | null) => void }) {
  const selectedSlice = selectedLabel ? slices.find((slice) => slice.label === selectedLabel) : null
  return (
    <section className="min-w-0 overflow-hidden rounded-[2rem] border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400">Allocation</h2>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            Total analyzed <span className="font-bold text-neutral-950 dark:text-neutral-50">{displayAmount(amountsHidden, formatCurrency(totalValueUSD))}</span>
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{slices.length} slices</span>
      </div>
      <div className="relative mt-4 h-72 min-w-0 overflow-hidden sm:h-96">
        <DonutChart
          innerRadius="58%"
          onSliceClick={(slice) => onSliceClick?.(slice.label)}
          onSliceMouseEnter={(slice) => onSliceClick?.(slice.label)}
          onSliceMouseLeave={() => onSliceClick?.(null)}
          outerRadius="98%"
          paddingAngle={2}
          slices={slices.map((slice, index) => ({
            key: slice.label,
            label: slice.label,
            value: slice.valueUSD,
            color: analysisSliceColor(slice.label, index),
            selected: selectedLabel === slice.label,
          }))}
        >
            <Tooltip formatter={(value, name) => [displayAmount(amountsHidden, formatCurrency(Number(value))), String(name)]} />
        </DonutChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="max-w-36 truncate text-xs uppercase tracking-[0.18em] text-neutral-400">{selectedSlice?.label ?? 'Total'}</span>
          <span className="mt-1 text-3xl font-bold text-neutral-950 dark:text-neutral-50">{displayAmount(amountsHidden, formatCurrencyCompact(selectedSlice?.valueUSD ?? totalValueUSD))}</span>
        </div>
      </div>
    </section>
  )
}
