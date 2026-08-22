import { useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { CollapsibleFilterSection } from '../components/common/CollapsibleFilterSection'
import { filterSummary } from '../components/common/filterSummary'
import { ErrorState } from '../components/common/ErrorState'
import { FilterListPicker } from '../components/common/FilterListPicker'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { PageToolbar, PageToolbarActions, PageToolbarSegmentedControl } from '../components/common/PageToolbar'
import { UnderlineTabs, type UnderlineTabItem } from '../components/common/UnderlineTabs'
import { SpendingBreakdown, type SpendingCategoryFocus } from '../components/reports/SpendingBreakdown'
import { CategoryChecklist } from '../components/reports/CategoryFilter'
import { DateRangeInputs } from '../components/reports/DateRangeSelector'
import { ReportFilterDropdown, ReportFilterSection } from '../components/reports/ReportFilterDropdown'
import { ReportsMobileFilters, type ReportsPendingFilter } from '../components/reports/ReportsMobileFilters'
import { ReportsTransactionList } from '../components/reports/ReportsTransactionList'
import { SpendingComparison } from '../components/reports/SpendingComparison'
import { SpendingTrends } from '../components/reports/SpendingTrends'
import { OwnerFilterSection } from '../components/reports/OwnerFilterDropdown'
import { useMobileHeader } from '../components/layout/useMobileHeader'
import { useCategories, useCategoryGroups } from '../hooks/useEntityQueries'
import { useFiltersActive } from '../hooks/useFiltersActive'
import { usePermissions } from '../hooks/usePermissions'
import { useSpendingByCategory } from '../hooks/useSpending'
import { defaultDateRangeForSpendingTab, useSpendingFilterParams } from '../hooks/useSpendingFilterParams'
import { isOneOf } from '../hooks/urlParams'
import type { TransactionsFilter } from '../types/graphql'

type ExpenseTab = 'breakdown' | 'trends' | 'comparison'

const expenseTabs: UnderlineTabItem<ExpenseTab>[] = [
  { value: 'breakdown', children: 'Breakdown' },
  { value: 'trends', children: 'Trends' },
  { value: 'comparison', children: 'Comparison' },
]
const expenseTabValues = expenseTabs.map((tab) => tab.value)

const groupingOptions: Array<{ value: 'category' | 'group'; label: string }> = [
  { value: 'category', label: 'By category' },
  { value: 'group', label: 'By group' },
]

function expenseTabFromParam(value: string | undefined): ExpenseTab | null {
  return isOneOf(expenseTabValues, value) ? value : null
}

export function ReportsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { tab: tabParam } = useParams()
  const tab = expenseTabFromParam(tabParam)
  const activeTab = tab ?? 'breakdown'
  const {
    dateFrom,
    dateTo,
    granularity, setGranularity,
    categoryIds, setCategoryIds,
    ownerIds, setOwnerIds,
    groupBy, setGroupBy,
    breakdownView, setBreakdownView,
    trendsView, setTrendsView,
    sort, setSort,
    setMany,
    filter,
  } = useSpendingFilterParams(activeTab)

  const [focusedCategoryId, setFocusedCategoryId] = useState<string | null>(null)
  const [focusedCategoryIds, setFocusedCategoryIds] = useState<string[] | null>(null)
  const [expanded, setExpanded] = useState(false)
  const { canRead } = usePermissions()
  const { categories } = useCategories()
  const [desktopCategoriesOpen, setDesktopCategoriesOpen] = useState(false)
  const mobile = useMobileHeader()

  function applyFilter(pending: ReportsPendingFilter) {
    setMany(pending)
    clearCategoryFocus()
    setExpanded(false)
    mobile.closeFilter()
  }

  function clearFilter() {
    const { dateFrom: nextDateFrom, dateTo: nextDateTo } = defaultDateRangeForSpendingTab(activeTab, granularity)
    setMany({
      dateFrom: nextDateFrom,
      dateTo: nextDateTo,
      categoryIds: [],
      ownerIds: [],
    })
    clearCategoryFocus()
    setExpanded(false)
    mobile.closeFilter()
  }

  function handleDateRangeChange(next: { dateFrom: string; dateTo: string }) {
    setMany({ dateFrom: next.dateFrom, dateTo: next.dateTo })
    clearCategoryFocus()
    setExpanded(false)
  }

  function handleGranularityChange(nextGranularity: typeof granularity) {
    setGranularity(nextGranularity)
    clearCategoryFocus()
    setExpanded(false)
  }

  function handleCategoryFilterChange(nextCategoryIds: string[]) {
    setCategoryIds(nextCategoryIds)
    clearCategoryFocus()
    setExpanded(false)
  }

  function handleTabChange(nextTab: ExpenseTab) {
    if (focusedCategoryId === 'everything-else') clearCategoryFocus()
    navigate({ pathname: `/expenses/${nextTab}`, search: location.search })
  }

  function handleBreakdownCategoryFocusChange(focus: SpendingCategoryFocus | null) {
    setFocusedCategoryId(focus?.id ?? null)
    setFocusedCategoryIds(focus?.categoryIds ?? null)
  }

  function handleTrendsCategoryFocusChange(categoryId: string | null) {
    setFocusedCategoryId(categoryId)
    setFocusedCategoryIds(null)
  }

  function clearCategoryFocus() {
    setFocusedCategoryId(null)
    setFocusedCategoryIds(null)
  }

  const transactionFilter: TransactionsFilter = useMemo(() => {
    let resolvedCategoryIds: string[] | undefined
    if (focusedCategoryIds) {
      resolvedCategoryIds = focusedCategoryIds
    } else if (focusedCategoryId) {
      if (groupBy === 'group') {
        resolvedCategoryIds = categories
          .filter((c) => c.groupName === focusedCategoryId)
          .map((c) => c.id)
      } else {
        resolvedCategoryIds = [focusedCategoryId]
      }
    } else if (categoryIds.length) {
      resolvedCategoryIds = categoryIds
    }
    return {
      datetimeRange: filter.datetimeRange,
      isHidden: false,
      ...(resolvedCategoryIds?.length ? { categoryIds: resolvedCategoryIds } : {}),
      ...(ownerIds.length ? { ownerIds } : {}),
    }
  }, [filter.datetimeRange, focusedCategoryId, focusedCategoryIds, categoryIds, groupBy, categories, ownerIds])

  const { categoryGroups } = useCategoryGroups()
  const spending = useSpendingByCategory(filter)

  const activePeriods = activeTab === 'breakdown' && spending.period ? [spending.period] : spending.periods
  const allCategories = activePeriods.flatMap((p) => p.categories.map((c) => c.category))
  const focusedCategory = allCategories.find((cat) => cat.id === focusedCategoryId) ??
    (groupBy === 'group'
      ? (() => {
          const grouped = activePeriods.flatMap((p) => p.categories)
          const g = grouped.find((c) => c.category.groupName === String(focusedCategoryId))
          return g ? { id: focusedCategoryId!, name: g.category.groupName, emoji: g.category.groupEmoji, groupName: g.category.groupName, groupEmoji: g.category.groupEmoji, kind: 'EXPENSE' as const, sortOrder: 0 } : undefined
        })()
      : undefined)

  const focusedCategoryDisplay = focusedCategoryId === 'everything-else'
    ? { emoji: '•', name: 'Everything else' }
    : focusedCategory
    ? { emoji: focusedCategory.emoji, name: focusedCategory.name }
    : undefined
  const defaultDateRange = defaultDateRangeForSpendingTab(activeTab, granularity)
  const dateRangeFiltered = activeTab !== 'comparison' && (dateFrom !== defaultDateRange.dateFrom || dateTo !== defaultDateRange.dateTo)
  const activeFilterCount = ownerIds.length + categoryIds.length + (dateRangeFiltered ? 1 : 0)
  useFiltersActive(activeFilterCount)

  if (!tab) {
    return <Navigate replace to={{ pathname: '/expenses/breakdown', search: location.search }} />
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      <PageToolbar className="flex-nowrap gap-2">
        <UnderlineTabs ariaLabel="Expense report views" items={expenseTabs} value={tab} onChange={handleTabChange} />
        <PageToolbarActions>
          {activeTab !== 'comparison' ? (
            <PageToolbarSegmentedControl ariaLabel="Expense grouping" options={groupingOptions} value={groupBy} onChange={setGroupBy} />
          ) : null}
          <ReportFilterDropdown activeFilterCount={activeFilterCount} onClear={clearFilter}>
            <div className="space-y-4">
              {activeTab !== 'comparison' ? (
                <ReportFilterSection active={dateRangeFiltered}>
                  <DateRangeInputs dateFrom={dateFrom} dateTo={dateTo} layout="compact" onChange={handleDateRangeChange} />
                </ReportFilterSection>
              ) : null}
              <OwnerFilterSection onChange={setOwnerIds} selectedOwners={ownerIds} />
              <CollapsibleFilterSection active={categoryIds.length > 0} expanded={desktopCategoriesOpen} label="Categories" summary={filterSummary(categoryIds.length)} onToggle={() => setDesktopCategoriesOpen((open) => !open)}>
                <FilterListPicker>
                  <CategoryChecklist categoryGroups={categoryGroups} onChange={handleCategoryFilterChange} selectedCategoryIds={categoryIds} />
                </FilterListPicker>
              </CollapsibleFilterSection>
            </div>
          </ReportFilterDropdown>
        </PageToolbarActions>
      </PageToolbar>
      {spending.fetching && activeTab === 'breakdown' ? <LoadingSpinner label="Loading spending report" /> : null}
      {spending.error && activeTab !== 'comparison' ? <ErrorState message="Could not load spending data." onRetry={() => spending.reexecuteQuery({ requestPolicy: 'network-only' })} /> : null}
      {activeTab === 'breakdown' && !spending.fetching ? <SpendingBreakdown expanded={expanded} focusedCategoryId={focusedCategoryId} groupBy={groupBy} onCategoryFocusChange={handleBreakdownCategoryFocusChange} onToggleExpanded={() => setExpanded((e) => !e)} onViewChange={setBreakdownView} period={spending.period} view={breakdownView} /> : null}
      {activeTab === 'trends' ? <SpendingTrends focusedCategoryId={focusedCategoryId} granularity={granularity} groupBy={groupBy} onCategoryFocusChange={handleTrendsCategoryFocusChange} onGranularityChange={handleGranularityChange} onViewChange={setTrendsView} periods={spending.periods} view={trendsView} /> : null}
      {activeTab === 'comparison' ? <SpendingComparison categoryIds={categoryIds} owners={ownerIds.length ? ownerIds : undefined} /> : null}
      {focusedCategoryDisplay && activeTab !== 'comparison' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:border-brand-300 dark:bg-brand-950/70 dark:text-neutral-100">
          <div>
            Showing <span className="font-semibold">{focusedCategoryDisplay.emoji} {focusedCategoryDisplay.name}</span> transactions{activeTab === 'trends' ? ' across the selected period range' : ' for this period'}.
          </div>
          <button className="font-semibold text-brand-700 hover:text-brand-900 dark:text-brand-200 dark:hover:text-white" onClick={clearCategoryFocus} type="button">Clear filter</button>
        </div>
      ) : null}
      {canRead('transactions') && activeTab !== 'comparison' ? (
        <ReportsTransactionList
          categories={categories}
          onCategoryUpdated={() => spending.reexecuteQuery({ requestPolicy: 'network-only' })}
          sort={sort}
          onSortChange={setSort}
          transactionFilter={transactionFilter}
        />
      ) : null}

      {mobile.filterOpen && (
        <ReportsMobileFilters
          activeTab={activeTab}
          breakdownView={breakdownView}
          categoryIds={categoryIds}
          dateFrom={dateFrom}
          dateTo={dateTo}
          granularity={granularity}
          groupBy={groupBy}
          ownerIds={ownerIds}
          trendsView={trendsView}
          onApply={applyFilter}
          onBreakdownViewChange={setBreakdownView}
          onClear={clearFilter}
          onClose={mobile.closeFilter}
          onGranularityChange={handleGranularityChange}
          onGroupByChange={setGroupBy}
          onTrendsViewChange={setTrendsView}
        />
      )}
    </div>
  )
}
