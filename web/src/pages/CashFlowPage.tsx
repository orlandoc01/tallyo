import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMobileHeader, useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { MobileFilterButton } from '../components/common/MobileFilterDropdown'
import { QueryGate } from '../components/common/QueryGate'
import { CashFlowBars, CashFlowLegend } from '../components/reports/CashFlowBars'
import { CashFlowBreakdownCard } from '../components/reports/CashFlowBreakdownCard'
import { CashFlowFilterPanel } from '../components/reports/CashFlowFilterPanel'
import { CashFlowHeaderCard } from '../components/reports/CashFlowHeaderCard'
import { CashFlowMobileFilters, type CashFlowPendingFilter } from '../components/reports/CashFlowMobileFilters'
import { buildCashFlowSeries, cashFlowDatePresets, isDefaultCashFlowRange, type LocalDateRange } from '../components/reports/cashFlowStats'
import { useCashFlow } from '../hooks/useCashFlow'
import { useCashFlowFilterParams } from '../hooks/useCashFlowFilterParams'
import { useTransactionsSummary } from '../hooks/useTransactionsSummary'
import { getLastThreePeriodDateRange } from '../utils/dates'

export function CashFlowPage() {
  const { dateFrom, dateTo, granularity, setGranularity, ownerIds, setOwnerIds, setMany, filter } = useCashFlowFilterParams()
  const { summary } = useTransactionsSummary()
  const mobile = useMobileHeader()
  const navigate = useNavigate()
  const now = new Date()
  const range: LocalDateRange = { dateFrom, dateTo }
  const defaultRange = getLastThreePeriodDateRange(granularity, now)
  const dateFiltered = !isDefaultCashFlowRange(range, granularity, now)
  const filterCount = ownerIds.length + (dateFiltered ? 1 : 0)
  const firstDate = summary?.firstDate
  const presets = useMemo(() => cashFlowDatePresets(firstDate), [firstDate])

  const cashFlow = useCashFlow(filter)
  const { periods } = cashFlow
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)
  const rememberedIndex = periods.findIndex((period) => period.periodLabel === selectedLabel)
  const selectedIndex = rememberedIndex === -1 ? Math.max(0, periods.length - 1) : rememberedIndex
  const selectedPeriod = periods[selectedIndex]
  const series = useMemo(() => buildCashFlowSeries(periods), [periods])

  function clearFilters() {
    setMany({ ...defaultRange, ownerIds: [] })
  }

  function applyMobileFilters(pending: CashFlowPendingFilter) {
    setMany(pending)
    mobile.closeFilter()
  }

  const mobileHeaderActions = useMemo(() => (
    <MobileFilterButton active={mobile.filterOpen} ariaLabel="Open cash flow filters" count={filterCount} onClick={mobile.filterOpen ? mobile.closeFilter : mobile.openFilter} />
  ), [filterCount, mobile.closeFilter, mobile.filterOpen, mobile.openFilter])
  useMobileHeaderActions(mobileHeaderActions)

  function openCategoryTransactions(categoryId: string) {
    if (!selectedPeriod) return
    const params = new URLSearchParams({ category_ids: categoryId, start_date: selectedPeriod.periodStart, end_date: selectedPeriod.periodEnd })
    navigate(`/transactions?${params}`)
  }

  return (
    <div className="space-y-3">
      <h1 className="sr-only">Cash Flow</h1>
      <CashFlowHeaderCard
        filterCount={filterCount}
        filters={(caretRight) => (
          <CashFlowFilterPanel
            caretRight={caretRight}
            dateFiltered={dateFiltered}
            now={now}
            ownerIds={ownerIds}
            presets={presets}
            range={range}
            onClear={clearFilters}
            onOwnerChange={setOwnerIds}
            onRangeChange={setMany}
            onResetRange={() => setMany(defaultRange)}
          />
        )}
        granularity={granularity}
        now={now}
        periods={periods}
        selectedIndex={selectedIndex}
        onGranularityChange={setGranularity}
      >
        <QueryGate data={cashFlow.fetching ? undefined : periods} empty={periods.length === 0} emptyTitle="No cash flow data for this range" error={cashFlow.error} errorPrefix="Failed to load cash flow" fetching={cashFlow.fetching} loadingLabel="Loading cash flow" onRetry={() => cashFlow.refetch({ requestPolicy: 'network-only' })}>
          <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_150px] lg:gap-6">
            <CashFlowBars series={series} selectedIndex={selectedIndex} onSelect={(index) => setSelectedLabel(periods[index].periodLabel)} />
            <CashFlowLegend series={series} />
          </div>
        </QueryGate>
      </CashFlowHeaderCard>
      {selectedPeriod ? (
        <div className="grid gap-3 lg:grid-cols-[repeat(auto-fit,minmax(360px,1fr))]">
          <CashFlowBreakdownCard items={selectedPeriod.incomeByCategory} title="Income" tone="income" total={selectedPeriod.summary.income} onItemClick={openCategoryTransactions} />
          <CashFlowBreakdownCard items={selectedPeriod.expensesByCategory} title="Expenses" tone="expenses" total={selectedPeriod.summary.expenses} onItemClick={openCategoryTransactions} />
        </div>
      ) : null}
      {mobile.filterOpen ? (
        <CashFlowMobileFilters
          defaultRange={defaultRange}
          now={now}
          ownerIds={ownerIds}
          presets={presets}
          range={range}
          onApply={applyMobileFilters}
          onClose={mobile.closeFilter}
        />
      ) : null}
    </div>
  )
}
