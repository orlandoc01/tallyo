import { useState } from 'react'
import { useNavigate } from 'react-router'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { MobileFilterDropdown } from '../components/common/MobileFilterDropdown'
import { MobileFilterFooter } from '../components/common/MobileFilterFooter'
import { PageToolbar, PageToolbarActions, PageToolbarSegmentedControl } from '../components/common/PageToolbar'
import { CashFlowCategoryBreakdown } from '../components/reports/CashFlowCategoryBreakdown'
import { CashFlowChart } from '../components/reports/CashFlowChart'
import { DateRangeInputs, DateRangeSelector } from '../components/reports/DateRangeSelector'
import { getDateRangePresetDates, type DateRangePresetOption } from '../components/reports/dateRangePresets'
import { OwnerFilterSection } from '../components/reports/OwnerFilterDropdown'
import { ReportFilterDropdown, ReportFilterSection } from '../components/reports/ReportFilterDropdown'
import { useCashFlow } from '../hooks/useCashFlow'
import { useCashFlowFilterParams } from '../hooks/useCashFlowFilterParams'
import { useFiltersActive } from '../hooks/useFiltersActive'
import { useMobileHeader } from '../components/layout/useMobileHeader'
import { useTransactionsSummary } from '../hooks/useTransactionsSummary'
import { Granularity } from '../types/graphql'
import { formatCurrency, formatSignedCurrency } from '../utils/currency'
import { getLastThreePeriodDateRange } from '../utils/dates'

const granularityOptions: Array<{ value: Granularity; label: string }> = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'YEARLY', label: 'Yearly' },
]

type CashFlowPendingFilter = {
  dateFrom: string
  dateTo: string
  granularity: Granularity
  ownerIds: string[]
}

export function CashFlowPage() {
  const {
    dateFrom,
    dateTo,
    granularity,
    ownerIds, setOwnerIds,
    setMany,
    filter,
  } = useCashFlowFilterParams()

  const { summary } = useTransactionsSummary()
  const allDates = getDateRangePresetDates('all')
  const defaultDateRange = getLastThreePeriodDateRange(granularity)
  const cashFlowPresets: DateRangePresetOption[] = [
    { label: 'Last 3 months', value: 'last_3_months' },
    { label: 'This year', value: 'this_year' },
    { label: 'All', value: 'all', dateFrom: summary?.firstDate ?? allDates.dateFrom, dateTo: allDates.dateTo },
  ]

  const mobile = useMobileHeader()

  function handleDesktopDateRangeChange(next: { dateFrom: string; dateTo: string }) {
    setMany({ dateFrom: next.dateFrom, dateTo: next.dateTo })
  }

  function handleGranularityChange(nextGranularity: Granularity) {
    const nextDateRange = getLastThreePeriodDateRange(nextGranularity)
    setMany({ dateFrom: nextDateRange.dateFrom, dateTo: nextDateRange.dateTo, granularity: nextGranularity })
  }

  function applyMobileDateFilter(pending: CashFlowPendingFilter) {
    setMany(pending)
    mobile.closeFilter()
  }

  function clearFilter() {
    const nextDateRange = getLastThreePeriodDateRange(granularity)
    setMany({
      dateFrom: nextDateRange.dateFrom,
      dateTo: nextDateRange.dateTo,
      ownerIds: [],
    })
  }

  const cashFlow = useCashFlow(filter)
  const dateRangeFiltered = dateFrom !== defaultDateRange.dateFrom || dateTo !== defaultDateRange.dateTo
  const activeFilterCount = ownerIds.length + (dateRangeFiltered ? 1 : 0)
  const periodsKey = cashFlow.periods.map((p) => p.periodLabel).join(',')
  useFiltersActive(activeFilterCount)

  return (
    <div className="space-y-6">
      <PageToolbar>
        <PageToolbarActions>
          <PageToolbarSegmentedControl ariaLabel="Cash flow granularity" options={granularityOptions} value={granularity} onChange={handleGranularityChange} />
          <ReportFilterDropdown activeFilterCount={activeFilterCount} onClear={clearFilter}>
            <div className="space-y-4">
              <ReportFilterSection active={dateRangeFiltered}>
                <DateRangeInputs dateFrom={dateFrom} dateTo={dateTo} layout="compact" onChange={handleDesktopDateRangeChange} presets={cashFlowPresets} />
              </ReportFilterSection>
              <OwnerFilterSection onChange={setOwnerIds} selectedOwners={ownerIds} />
            </div>
          </ReportFilterDropdown>
        </PageToolbarActions>
      </PageToolbar>
      <CashFlowPeriodContent key={periodsKey} cashFlow={cashFlow} />

      {mobile.filterOpen && (
        <CashFlowMobileFilters
          dateFrom={dateFrom}
          dateTo={dateTo}
          granularity={granularity}
          ownerIds={ownerIds}
          presets={cashFlowPresets}
          onApply={applyMobileDateFilter}
          onClose={mobile.closeFilter}
        />
      )}
    </div>
  )
}

function CashFlowPeriodContent({ cashFlow }: { cashFlow: ReturnType<typeof useCashFlow> }) {
  const navigate = useNavigate()
  const periods = cashFlow.periods
  const [selectedPeriodIndex, setSelectedPeriodIndex] = useState(Math.max(0, periods.length - 1))
  const clampedPeriodIndex = Math.min(selectedPeriodIndex, Math.max(0, periods.length - 1))
  const selectedPeriod = periods[clampedPeriodIndex]
  const incomeTotal = selectedPeriod?.summary.income ?? 0
  const expenseTotal = selectedPeriod?.summary.expenses ?? 0
  const savings = incomeTotal - expenseTotal

  function handleCategoryClick(categoryId: string) {
    if (!selectedPeriod) return
    const params = new URLSearchParams({
      category_ids: String(categoryId),
      start_date: selectedPeriod.periodStart,
      end_date: selectedPeriod.periodEnd,
    })
    navigate(`/transactions?${params}`)
  }

  return (
    <>
      <CashFlowChart periods={periods} selectedPeriodIndex={clampedPeriodIndex} onSelectPeriod={setSelectedPeriodIndex} />
      {cashFlow.fetching ? <LoadingSpinner /> : null}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard label="Income" tone="green" value={formatCurrency(incomeTotal)} />
        <SummaryCard label="Expenses" tone="red" value={formatCurrency(expenseTotal)} />
        <SummaryCard label="Total savings" value={formatSignedCurrency(savings)} />
        <SummaryCard label="Savings rate" value={incomeTotal ? `${Math.round((savings / incomeTotal) * 100)}%` : '0%'} />
      </div>
      <CashFlowCategoryBreakdown title="Income" items={selectedPeriod?.incomeByCategory ?? []} tone="green" onItemClick={handleCategoryClick} />
      <CashFlowCategoryBreakdown title="Expenses" items={selectedPeriod?.expensesByCategory ?? []} tone="red" onItemClick={handleCategoryClick} />
    </>
  )
}

function CashFlowMobileFilters({ dateFrom, dateTo, granularity, ownerIds, presets, onApply, onClose }: {
  dateFrom: string
  dateTo: string
  granularity: Granularity
  ownerIds: string[]
  presets: DateRangePresetOption[]
  onApply: (pending: CashFlowPendingFilter) => void
  onClose: () => void
}) {
  const [pendingDateFrom, setPendingDateFrom] = useState(dateFrom)
  const [pendingDateTo, setPendingDateTo] = useState(dateTo)
  const [pendingGranularity, setPendingGranularity] = useState<Granularity>(granularity)
  const [pendingOwners, setPendingOwners] = useState(ownerIds)
  const pendingDefaultDateRange = getLastThreePeriodDateRange(pendingGranularity)
  const pendingDateRangeFiltered = pendingDateFrom !== pendingDefaultDateRange.dateFrom || pendingDateTo !== pendingDefaultDateRange.dateTo

  return (
    <MobileFilterDropdown
      bodyClassName="space-y-6"
      footer={<MobileFilterFooter secondaryLabel="Cancel" onPrimary={() => onApply({ dateFrom: pendingDateFrom, dateTo: pendingDateTo, granularity: pendingGranularity, ownerIds: pendingOwners })} onSecondary={onClose} />}
      labelledBy="cash-flow-filters-title"
      onClose={onClose}
    >
      <ReportFilterSection active={pendingDateRangeFiltered}>
        <DateRangeSelector
          className="space-y-3"
          dateFrom={pendingDateFrom}
          dateInputLayout="compact"
          dateTo={pendingDateTo}
          granularity={pendingGranularity}
          onChange={(next) => {
            if (next.granularity !== pendingGranularity) {
              const nextDateRange = getLastThreePeriodDateRange(next.granularity)
              setPendingDateFrom(nextDateRange.dateFrom)
              setPendingDateTo(nextDateRange.dateTo)
              setPendingGranularity(next.granularity)
              return
            }

            setPendingDateFrom(next.dateFrom)
            setPendingDateTo(next.dateTo)
            setPendingGranularity(next.granularity)
          }}
          presets={presets}
        />
      </ReportFilterSection>
      <OwnerFilterSection onChange={setPendingOwners} selectedOwners={pendingOwners} />
    </MobileFilterDropdown>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-4 text-center shadow-card md:p-6">
      <div className={`text-2xl font-bold ${tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-red-600' : ''}`}>{value}</div>
      <div className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">{label}</div>
    </div>
  )
}
