import { useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { useFilterCaretRight } from '../../hooks/useFilterCaretRight'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { SpendingFilterTab } from '../../hooks/useSpendingFilterParams'
import { formatCurrency } from '../../utils/currency'
import { DeltaText } from '../common/DeltaText'
import { FiltersButton } from '../common/FiltersButton'
import { Card } from '../common/FormControls'
import { PillTabs, type PillTab } from '../common/PillTabs'
import { StatBlock, StatGrid } from '../common/StatBlock'
import { dailyAverage, elapsedDays, spendingDelta } from './expensesStats'
import { EXPENSE_TABS } from './expenseTabs'

export interface ExpensesStatsData {
  total: number
  transactionCount: number
  categoryCount: number
  dateFrom: string
  dateTo: string
  previousTotal: number | null
  previousLabel: string
  now: Date
}

export function ExpensesHeaderCard({ children, controls, filterCount, filters, stats, tab }: {
  children: ReactNode
  controls?: ReactNode
  filterCount: number
  filters: (caretRight: number | undefined) => ReactNode
  stats: ExpensesStatsData
  tab: SpendingFilterTab
}) {
  const location = useLocation()
  const isMobile = useIsMobile()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const filtersButtonRef = useRef<HTMLButtonElement>(null)
  const caretRight = useFilterCaretRight(filtersOpen, filtersButtonRef, cardRef)
  const tabs: PillTab<SpendingFilterTab>[] = EXPENSE_TABS.map((item) => ({ ...item, to: `/expenses/${item.value}${location.search}` }))

  return (
    <Card overflow="visible" padded>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-2" ref={cardRef}>
        <PillTabs ariaLabel="Expense report views" tabs={tabs} value={tab} variant={isMobile ? 'track' : 'bare'} />
        <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
          {controls}
          <div className="hidden lg:block">
            <FiltersButton count={filterCount} onClick={() => setFiltersOpen((current) => !current)} open={filtersOpen} ref={filtersButtonRef} />
          </div>
        </div>
      </div>
      {filtersOpen ? <div className="hidden lg:block">{filters(caretRight)}</div> : null}
      <ExpensesStats stats={stats} />
      {children}
    </Card>
  )
}

function ExpensesStats({ stats }: { stats: ExpensesStatsData }) {
  const { elapsed, total: totalDays } = elapsedDays(stats, stats.now)
  const delta = spendingDelta(stats.total, stats.previousTotal)
  const txns = `${stats.transactionCount} txns`

  return (
    <StatGrid className="mt-[18px] lg:mt-6" columns={2} layout="row">
      <StatBlock
        label="Spending"
        size="lg"
        sublabel={delta ? <DeltaText changePct={delta.changePct} changeUSD={delta.changeUSD} invert size="sm" suffix={` ${stats.previousLabel}`} /> : undefined}
        value={formatCurrency(stats.total)}
      />
      <StatBlock label="Daily average" size="lg" sublabel={<>{elapsed} of {totalDays} days<span className="lg:hidden"> · {txns}</span></>} value={formatCurrency(dailyAverage(stats.total, elapsed))} />
      <div className="hidden lg:block">
        <StatBlock label="Transactions" size="lg" sublabel={`${stats.categoryCount} categories`} value={String(stats.transactionCount)} />
      </div>
    </StatGrid>
  )
}
