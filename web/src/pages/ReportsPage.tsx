import { AlignLeft, PieChart } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router'
import { useQuery } from 'urql'
import { Button } from '../components/common/Button'
import { MobileFilterButton } from '../components/common/MobileFilterDropdown'
import { QueryGate } from '../components/common/QueryGate'
import { SegmentedControl } from '../components/common/SegmentedControl'
import { EXPENSE_TABS } from '../components/reports/expenseTabs'
import { ExpensesHeaderCard } from '../components/reports/ExpensesHeaderCard'
import { ExpensesFilterPanel } from '../components/reports/ExpensesFilterPanel'
import { ExpensesMobileFilters } from '../components/reports/ExpensesMobileFilters'
import { activeSpendingFilterCount, isAllTime, spendingFilterFromTransactionsFilter, spendingFilterToTransactionsFilter } from '../components/reports/expensesFilter'
import { previousRange } from '../components/reports/expensesStats'
import { ReportsTransactionList } from '../components/reports/ReportsTransactionList'
import { SpendingBreakdown, type SpendingCategoryFocus } from '../components/reports/SpendingBreakdown'
import { SpendingComparison } from '../components/reports/SpendingComparison'
import { SpendingTrends } from '../components/reports/SpendingTrends'
import { TransactionActivePills } from '../components/transactions/TransactionActivePills'
import { useMobileHeader, useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { SPENDING_TOTALS_QUERY } from '../graphql/queries'
import { useAccounts, useCategories, useCategoryGroups, useOwners } from '../hooks/useEntityQueries'
import { useNormalizeTabParam } from '../hooks/useNormalizeTabParam'
import { usePermissions } from '../hooks/usePermissions'
import { GRANULARITY_OPTIONS } from '../hooks/useReportFilterParamCore'
import { useSpendingByCategory } from '../hooks/useSpending'
import { defaultDateRangeForSpendingTab, type SpendingFilterTab, useSpendingFilterParams } from '../hooks/useSpendingFilterParams'
import { useTransactionsSummary } from '../hooks/useTransactionsSummary'
import { isOneOf } from '../hooks/urlParams'
import type { Category, SpendingByCategoryReport, SpendingFilter, TransactionsFilter } from '../types/graphql'
import { localDateRangeToUtcDateTimeRange } from '../utils/dates'

const EXPENSE_TAB_VALUES = EXPENSE_TABS.map((tab) => tab.value)
const isExpenseTab = (value: string): value is SpendingFilterTab => isOneOf(EXPENSE_TAB_VALUES, value)

function focusLabel(id: string, categories: Category[]) {
  if (id === 'everything-else') return '• Everything else'
  const category = categories.find((item) => item.id === id)
  if (category) return `${category.emoji} ${category.name}`
  const group = categories.find((item) => item.groupName === id)
  return group ? `${group.groupEmoji} ${group.groupName}` : id
}

const GROUPING_OPTIONS = [
  { value: 'category', label: <><span className="lg:hidden">Category</span><span className="hidden lg:inline">By category</span></> },
  { value: 'group', label: <><span className="lg:hidden">Group</span><span className="hidden lg:inline">By group</span></> },
] as const
const VIEW_OPTIONS = [
  { value: 'pie', ariaLabel: 'Pie', iconOnly: true, label: <PieChart aria-hidden className="h-3.5 w-3.5" /> },
  { value: 'bar', ariaLabel: 'Bars', iconOnly: true, label: <AlignLeft aria-hidden className="h-3.5 w-3.5" /> },
] as const

// A focus belongs to the tab it was made on; switching tabs drops it.
interface TabFocus { tab: SpendingFilterTab; focus: SpendingCategoryFocus }

export function ReportsPage() {
  const { tab: tabParam } = useParams()
  const location = useLocation()
  const activeTab: SpendingFilterTab = tabParam && isExpenseTab(tabParam) ? tabParam : 'breakdown'
  const breakdownPath = useCallback(() => `/expenses/breakdown${location.search}`, [location.search])
  useNormalizeTabParam('expenses', tabParam, isExpenseTab, breakdownPath)
  const params = useSpendingFilterParams(activeTab)
  const { dateFrom, dateTo, granularity, categoryIds, accountIds, ownerIds, showHidden, groupBy, breakdownView, sort, setMany, filter } = params
  const now = useMemo(() => new Date(), [])
  const hasDate = activeTab !== 'comparison'

  const [tabFocus, setTabFocus] = useState<TabFocus | null>(null)
  const focus = tabFocus?.tab === activeTab ? tabFocus.focus : null
  const [expanded, setExpanded] = useState(false)
  const { canRead } = usePermissions()
  const canReadTransactions = canRead('transactions')
  const { categories } = useCategories()
  const { categoryGroups } = useCategoryGroups()
  const { accounts } = useAccounts()
  const { owners } = useOwners()
  const mobile = useMobileHeader()

  const values = useMemo(() => ({ dateFrom, dateTo, categoryIds, accountIds, ownerIds, showHidden }), [dateFrom, dateTo, categoryIds, accountIds, ownerIds, showHidden])
  const defaultRange = defaultDateRangeForSpendingTab(activeTab, granularity, now)
  const defaultDateTimeRange = localDateRangeToUtcDateTimeRange(defaultRange.dateFrom, defaultRange.dateTo)
  const dateFiltered = hasDate && (dateFrom !== defaultRange.dateFrom || dateTo !== defaultRange.dateTo)
  const isDateFiltered = useCallback((candidate: TransactionsFilter) => candidate.datetimeRange?.from !== defaultDateTimeRange?.from || candidate.datetimeRange?.to !== defaultDateTimeRange?.to, [defaultDateTimeRange?.from, defaultDateTimeRange?.to])
  const chipFilter = useMemo(() => spendingFilterToTransactionsFilter(values, now), [values, now])
  // Pills always carry the closed range so removing another pill keeps the dates.
  const pillFilter = useMemo(() => ({ ...chipFilter, datetimeRange: dateFiltered ? filter.datetimeRange : undefined }), [chipFilter, dateFiltered, filter.datetimeRange])
  const filterCount = activeSpendingFilterCount(values, dateFiltered)

  const spending = useSpendingByCategory(filter)
  const previous = useMemo(() => previousRange({ dateFrom, dateTo }), [dateFrom, dateTo])
  const previousFilter = useMemo((): SpendingFilter => ({ ...filter, datetimeRange: localDateRangeToUtcDateTimeRange(previous.dateFrom, previous.dateTo) ?? {} }), [filter, previous.dateFrom, previous.dateTo])
  const [previousResult] = useQuery<{ spendingByCategory: SpendingByCategoryReport }, { filter: SpendingFilter }>({ query: SPENDING_TOTALS_QUERY, variables: { filter: previousFilter } })
  const summary = useTransactionsSummary(params.transactionFilter, !canReadTransactions)
  const allSummary = useTransactionsSummary(useMemo(() => ({ isHidden: showHidden ? undefined : false }), [showHidden]), !canReadTransactions)

  function setFocus(next: SpendingCategoryFocus | null) {
    setTabFocus(next ? { tab: activeTab, focus: next } : null)
    setExpanded(false)
  }

  function applyTransactionsFilter(next: TransactionsFilter) {
    setMany(spendingFilterFromTransactionsFilter(next, values, now))
    setFocus(null)
  }

  function clearFilters() {
    setMany({ ...defaultRange, categoryIds: [], accountIds: [], ownerIds: [], showHidden: undefined })
    setFocus(null)
    mobile.closeFilter()
  }

  const mobileHeaderActions = useMemo(() => (
    <MobileFilterButton active={mobile.filterOpen} ariaLabel="Open expense filters" count={filterCount} onClick={mobile.filterOpen ? mobile.closeFilter : mobile.openFilter} />
  ), [filterCount, mobile.closeFilter, mobile.filterOpen, mobile.openFilter])
  useMobileHeaderActions(mobileHeaderActions)

  const transactionFilter: TransactionsFilter = useMemo(
    () => focus?.categoryIds.length ? { ...params.transactionFilter, categoryIds: focus.categoryIds } : params.transactionFilter,
    [params.transactionFilter, focus],
  )

  const report = spending.report
  const focusedLabel = focus ? focusLabel(focus.id, categories) : null
  const lookups = useMemo(() => ({ accounts, categories, owners }), [accounts, categories, owners])
  const activeRow = filterCount > 0 ? (
    <TransactionActivePills
      allCount={allSummary.summary?.totalCount}
      dateValue={isAllTime(values, now) ? 'All time' : undefined}
      filter={pillFilter}
      lookups={lookups}
      now={now}
      onChange={(next) => applyTransactionsFilter({ ...next, datetimeRange: next.datetimeRange ?? (dateFiltered ? defaultDateTimeRange : filter.datetimeRange) })}
      totalCount={summary.summary?.totalCount}
    />
  ) : undefined

  const controls = (
    <>
      {hasDate ? <SegmentedControl ariaLabel="Expense grouping" onChange={(value) => { params.setGroupBy(value); setFocus(null) }} options={GROUPING_OPTIONS} value={groupBy} /> : null}
      {activeTab === 'trends' ? <SegmentedControl ariaLabel="Granularity" onChange={(value) => { params.setGranularity(value); setFocus(null) }} options={GRANULARITY_OPTIONS} value={granularity} /> : null}
      {activeTab === 'breakdown' ? <SegmentedControl ariaLabel="Spending chart view" onChange={params.setBreakdownView} options={VIEW_OPTIONS} value={breakdownView} /> : null}
    </>
  )

  return (
    <div className="space-y-3">
      <h1 className="sr-only">Expenses</h1>
      <ExpensesHeaderCard
        controls={controls}
        filterCount={filterCount}
        filters={(caretRight) => (
          <ExpensesFilterPanel
            accounts={accounts}
            activeRow={activeRow}
            caretRight={caretRight}
            categoryGroups={categoryGroups}
            clearable={filterCount > 0}
            dateFiltered={dateFiltered}
            filter={chipFilter}
            now={now}
            onChange={applyTransactionsFilter}
            onClear={clearFilters}
            onRuleCreated={() => spending.reexecuteQuery({ requestPolicy: 'network-only' })}
            owners={owners}
            showDate={hasDate}
          />
        )}
        stats={{ total: report?.totalAmount ?? 0, transactionCount: report?.transactionCount ?? 0, categoryCount: report?.categories.filter((item) => item.totalAmount !== 0).length ?? 0, dateFrom, dateTo, previousTotal: previousResult.data?.spendingByCategory.totalAmount ?? null, previousLabel: previous.label, now }}
        tab={activeTab}
      >
        {activeTab === 'comparison' ? (
          <SpendingComparison accountIds={accountIds} categoryIds={categoryIds} owners={ownerIds.length ? ownerIds : undefined} showHidden={showHidden} />
        ) : (
          <QueryGate data={report ?? undefined} empty={!report?.categories.some((item) => item.totalAmount !== 0)} emptyTitle="No spending in this period" emptyDescription="Try another date range or clear the filters." error={spending.error} errorPrefix="Could not load spending data" fetching={spending.fetching} loadingLabel="Loading spending report" onRetry={() => spending.reexecuteQuery({ requestPolicy: 'network-only' })}>
            {activeTab === 'breakdown' ? (
              <SpendingBreakdown expanded={expanded} focusedCategoryId={focus?.id ?? null} groupBy={groupBy} onCategoryFocusChange={setFocus} onToggleExpanded={() => setExpanded((value) => !value)} period={spending.period} view={breakdownView} />
            ) : (
              <SpendingTrends focusedCategoryId={focus?.id ?? null} groupBy={groupBy} onCategoryFocusChange={setFocus} periods={spending.periods} />
            )}
          </QueryGate>
        )}
      </ExpensesHeaderCard>
      {focusedLabel && hasDate ? (
        <div className="flex items-center justify-between gap-3 px-1 text-[13px] text-text-3">
          <span>Showing <span className="font-medium text-text-1">{focusedLabel}</span> transactions.</span>
          <Button onClick={() => setFocus(null)} size="sm" variant="ghost">Clear filter</Button>
        </div>
      ) : null}
      {canReadTransactions && hasDate ? (
        <ReportsTransactionList categories={categories} onCategoryUpdated={() => spending.reexecuteQuery({ requestPolicy: 'network-only' })} sort={sort} onSortChange={params.setSort} transactionFilter={transactionFilter} />
      ) : null}
      {mobile.filterOpen ? (
        <ExpensesMobileFilters
          filter={chipFilter}
          isDateFiltered={isDateFiltered}
          now={now}
          onApply={(next) => { applyTransactionsFilter(next); mobile.closeFilter() }}
          onClear={clearFilters}
          onClose={mobile.closeFilter}
          onRuleCreated={() => spending.reexecuteQuery({ requestPolicy: 'network-only' })}
          showDate={hasDate}
        />
      ) : null}
    </div>
  )
}
