import { ChartArea, ChartLine, Eye, EyeOff } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { IconButton } from '../common/Button'
import { DeltaText } from '../common/DeltaText'
import { FiltersButton } from '../common/FiltersButton'
import { Card } from '../common/FormControls'
import { SegmentedControl } from '../common/SegmentedControl'
import { displayAmount } from './amountDisplay'
import { NetWorthChart, type ChartView } from './NetWorthChart'
import { rangeOption } from './netWorthRanges'
import { formatSignedCurrency } from '../../utils/currency'
import type { HistoricalNetWorthReport, NetWorthRange, NetWorthReport } from '../../types/graphql'

export function NetWorthCard({ amountsHidden, changePct, changeUSD, filterCount, filters, focusDate, historicalReport, range, report, onFocusDate, onToggleAmountsHidden }: {
  amountsHidden: boolean
  changePct: number
  changeUSD: number
  filterCount: number
  filters: ReactNode
  focusDate?: string
  historicalReport?: HistoricalNetWorthReport
  range: NetWorthRange
  report: NetWorthReport
  onFocusDate: (date: string | null) => void
  onToggleAmountsHidden: () => void
}) {
  const [view, setView] = useState<ChartView>('NET_WORTH')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [hoveredDate, setHoveredDate] = useState<string | null>(null)
  const points = historicalReport?.series ?? []
  const focusedPoint = focusDate ? points.find((point) => point.date === focusDate) : undefined
  const displayedPoint = (hoveredDate ? points.find((point) => point.date === hoveredDate) : undefined) ?? focusedPoint
  const displayedValue = displayedPoint?.netWorthUSD ?? report.currentNetWorthUSD
  const displayedDate = displayedPoint?.date ?? (focusDate ?? null)
  const [whole, cents] = splitCents(formatSignedCurrency(displayedValue))
  const rangeLabel = rangeOption(range).label
  const VisibilityIcon = amountsHidden ? EyeOff : Eye

  return (
    <Card className="p-4 lg:px-6 lg:pb-4 lg:pt-5" overflow="visible">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-text-muted">Net Worth</p>
          <p className="mt-0.5 text-[26px] font-semibold leading-8 tracking-[-0.4px] text-text-1 lg:text-[22px] lg:leading-7 lg:tracking-[-0.3px]">
            {amountsHidden ? displayAmount(true, `${whole}${cents}`) : <>{whole}<span className="text-sm font-medium text-text-3">{cents}</span></>}
          </p>
          <p className="mt-1">
            <DeltaText changePct={changePct} changeUSD={changeUSD} glyph={false} masked={amountsHidden} suffix={<span className="hidden lg:inline"> {rangeLabel.toLowerCase()}</span>} />
          </p>
          {displayedDate ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
              {displayedDate}
              {focusDate ? <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] font-medium text-text-2">Focused · click chart to clear</span> : null}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton ariaLabel={amountsHidden ? 'Show amounts' : 'Hide amounts'} className="hidden lg:inline-flex" onClick={onToggleAmountsHidden} pressed={amountsHidden}>
            <VisibilityIcon className="h-4 w-4" />
          </IconButton>
          <SegmentedControl
            ariaLabel="Net worth chart view"
            onChange={setView}
            options={[
              { value: 'NET_WORTH', label: <ChartLine className="h-4 w-4" />, iconOnly: true, ariaLabel: 'Net worth chart', title: 'Net Worth Chart' },
              { value: 'HISTORICAL_ALLOCATION', label: <ChartArea className="h-4 w-4" />, iconOnly: true, ariaLabel: 'Historical asset allocation chart', title: 'Historical Asset Allocation Chart' },
            ]}
            value={view}
          />
          <div className="hidden lg:block">
            <FiltersButton count={filterCount} onClick={() => setFiltersOpen((current) => !current)} open={filtersOpen} />
          </div>
        </div>
      </div>
      {filtersOpen ? <div className="hidden lg:block" data-net-worth-filters>{filters}</div> : null}
      <p className="mt-6 text-xs text-text-muted lg:hidden">{rangeLabel}</p>
      <div className="mt-5" data-net-worth-chart>
        <NetWorthChart
          amountsHidden={amountsHidden}
          asOfDate={report.asOfDate}
          classifierSeries={historicalReport?.classifierSeries}
          focusedDate={focusDate}
          hoveredDate={hoveredDate}
          liabilitySeries={historicalReport?.liabilitySeries}
          onFocusDate={onFocusDate}
          onHoverDate={setHoveredDate}
          points={points}
          view={view}
        />
      </div>
    </Card>
  )
}

function splitCents(formatted: string): [string, string] {
  const index = formatted.lastIndexOf('.')
  return index === -1 ? [formatted, ''] : [formatted.slice(0, index), formatted.slice(index)]
}
