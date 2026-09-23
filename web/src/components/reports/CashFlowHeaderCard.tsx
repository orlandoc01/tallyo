import { useRef, useState, type ReactNode } from 'react'
import { useFilterCaretRight } from '../../hooks/useFilterCaretRight'
import { GRANULARITY_OPTIONS } from '../../hooks/useReportFilterParamCore'
import type { CashFlowPeriod, Granularity } from '../../types/graphql'
import { formatCurrency, formatSignedCurrency } from '../../utils/currency'
import { FiltersButton } from '../common/FiltersButton'
import { Card } from '../common/FormControls'
import { SegmentedControl } from '../common/SegmentedControl'
import { StatBlock, StatGrid } from '../common/StatBlock'
import { averageSavingsRate, deltaText, deltaTone, granularityUnit, periodDelta, periodSpanLabel, savingsRatePct } from './cashFlowStats'

export function CashFlowHeaderCard({ children, filterCount, filters, granularity, now, periods, selectedIndex, onGranularityChange }: {
  children: ReactNode
  filterCount: number
  filters: (caretRight: number | undefined) => ReactNode
  granularity: Granularity
  now: Date
  periods: CashFlowPeriod[]
  selectedIndex: number
  onGranularityChange: (granularity: Granularity) => void
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const filtersButtonRef = useRef<HTMLButtonElement>(null)
  const caretRight = useFilterCaretRight(filtersOpen, filtersButtonRef, cardRef)

  return (
    <Card overflow="visible" padded>
      <div className="flex flex-col gap-[18px] lg:flex-row lg:items-start lg:justify-between lg:gap-6" ref={cardRef}>
        <CashFlowStats granularity={granularity} now={now} periods={periods} selectedIndex={selectedIndex} />
        <div className="order-first flex shrink-0 items-center gap-2 lg:order-none">
          <SegmentedControl ariaLabel="Cash flow granularity" fullWidth onChange={onGranularityChange} options={GRANULARITY_OPTIONS} value={granularity} />
          <div className="hidden lg:block">
            <FiltersButton count={filterCount} onClick={() => setFiltersOpen((current) => !current)} open={filtersOpen} ref={filtersButtonRef} />
          </div>
        </div>
      </div>
      {filtersOpen ? <div className="hidden lg:block">{filters(caretRight)}</div> : null}
      <div className="mt-5 lg:mt-7">{children}</div>
    </Card>
  )
}

function CashFlowStats({ granularity, now, periods, selectedIndex }: { granularity: Granularity; now: Date; periods: CashFlowPeriod[]; selectedIndex: number }) {
  const period = periods[selectedIndex]
  const income = period?.summary.income ?? 0
  const expenses = period?.summary.expenses ?? 0
  const incomeDelta = periodDelta(periods, selectedIndex, (item) => item.summary.income)
  const expenseDelta = periodDelta(periods, selectedIndex, (item) => item.summary.expenses)
  const average = averageSavingsRate(periods)

  return (
    <StatGrid className="min-w-0 flex-1" columns={2}>
      <StatBlock label="Income" size="lg" sublabel={incomeDelta ? <span className={deltaTone(incomeDelta.changeUSD)}>{deltaText(incomeDelta)}</span> : undefined} value={<span className="text-positive">{formatCurrency(income)}</span>} />
      <StatBlock label="Expenses" size="lg" sublabel={expenseDelta ? <span className={deltaTone(expenseDelta.changeUSD, true)}>{deltaText(expenseDelta)}</span> : undefined} value={<span className="text-negative">{formatCurrency(expenses)}</span>} />
      <StatBlock label="Total savings" size="lg" sublabel={period ? periodSpanLabel(period, now) : undefined} value={formatSignedCurrency(income - expenses)} />
      <StatBlock label="Savings rate" size="lg" sublabel={average.count ? `Avg ${average.count} ${granularityUnit(granularity)}: ${average.pct}%` : undefined} value={`${savingsRatePct({ income, expenses })}%`} />
    </StatGrid>
  )
}
