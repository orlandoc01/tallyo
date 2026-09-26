import { BarChart3 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Button, IconButton } from '../components/common/Button'
import { EmptyState } from '../components/common/EmptyState'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { SearchInput } from '../components/common/FormControls'
import { BulkActionBar, BulkSelectAllCheckbox, BulkTransactionModals } from '../components/transactions/BulkTransactionsUI'
import { TransactionActivePills } from '../components/transactions/TransactionActivePills'
import { TransactionFilterPanel } from '../components/transactions/TransactionFilterPanel'
import { TransactionList } from '../components/transactions/TransactionList'
import { TransactionsHeader } from '../components/transactions/TransactionsHeader'
import { TransactionsMobileFilters } from '../components/transactions/TransactionsMobileFilters'
import { TransactionsCreateFlow, type CreateStep } from '../components/transactions/TransactionsCreateFlow'
import { TransactionsMobileHeaderActions } from '../components/transactions/TransactionsMobileHeaderActions'
import { TransactionSummaryCard } from '../components/transactions/TransactionSummary'
import { useBulkTransactionActions } from '../components/transactions/useBulkTransactionActions'
import { useMobileHeader, useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { useFilterCaretRight } from '../hooks/useFilterCaretRight'
import { useIsMobile } from '../hooks/useIsMobile'
import { useTransactionSelection } from '../components/transactions/useTransactionSelection'
import { useAccounts, useCategories, useCategoryGroups, useOwners, useTags } from '../hooks/useEntityQueries'
import { useQueryParamState } from '../hooks/useQueryParamState'
import { usePaginatedTransactions } from '../hooks/useTransactions'
import { useTransactionsSummary } from '../hooks/useTransactionsSummary'
import { activeTransactionFilterCount, didNonTextFilterChange, useTransactionFilterParams } from '../hooks/useTransactionFilterParams'
import { useFiltersActive } from '../hooks/useFiltersActive'
import { usePermissions } from '../hooks/usePermissions'
import type { TransactionSort, TransactionsFilter } from '../types/graphql'

const DEFAULT_TRANSACTION_FILTER: TransactionsFilter = { isHidden: false }

export function TransactionsPage() {
  const navigate = useNavigate()
  const { transaction_id: selectedTransactionId } = useParams()
  const { filter, sort, setFilter, setSort, setFilterAndSort, clearFilters } = useTransactionFilterParams()
  const { accounts } = useAccounts()
  const { categories } = useCategories()
  const { categoryGroups } = useCategoryGroups()
  const { owners } = useOwners()
  const { tags } = useTags()
  const { closeFilter, filterOpen, openFilter } = useMobileHeader()
  const { enterBulkMode, isBulkMode, selectedIds, toggleSelected } = useTransactionSelection()
  const { canWrite } = usePermissions()
  const canWriteTransactions = canWrite('transactions')
  const isMobile = useIsMobile()
  const pageRef = useRef<HTMLDivElement>(null)
  const filtersButtonRef = useRef<HTMLButtonElement>(null)

  const [draftFilter, setDraftFilter] = useState<TransactionsFilter>(filter)
  const [search, setSearch] = useQueryParamState('q')
  const [createStep, setCreateStep] = useState<CreateStep>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [desktopFiltersOpen, setDesktopFiltersOpen] = useState(false)
  const trimmedSearch = search.trim()
  const summaryFilter = useMemo(() => trimmedSearch ? { ...draftFilter, search: trimmedSearch } : draftFilter, [draftFilter, trimmedSearch])
  const now = new Date()

  const transactions = usePaginatedTransactions(draftFilter, sort, 50, trimmedSearch || undefined)
  const summary = useTransactionsSummary(summaryFilter)
  const unfilteredSummaryFilter = useMemo(() => ({ isHidden: draftFilter.isHidden }), [draftFilter.isHidden])
  const allSummary = useTransactionsSummary(unfilteredSummaryFilter)
  const caretRight = useFilterCaretRight(desktopFiltersOpen, filtersButtonRef, pageRef)
  const refetchTransactions = () => transactions.reexecuteQuery({ requestPolicy: 'network-only' })
  const bulk = useBulkTransactionActions({ filter: summaryFilter, sort, refetch: refetchTransactions })
  const filteredTotalCount = summary.summary?.totalCount ?? 0
  const allFilteredSelected = filteredTotalCount > 0 && selectedIds.size === filteredTotalCount
  const someFilteredSelected = selectedIds.size > 0 && selectedIds.size < filteredTotalCount
  const activeFilterCount = activeTransactionFilterCount(draftFilter, trimmedSearch)
  const lookups = useMemo(() => ({ accounts, categories, owners, tags }), [accounts, categories, owners, tags])

  useEffect(() => {
    setDraftFilter(filter)
  }, [filter])

  const { cancelBulkMode } = bulk
  const mobileHeaderActions = useMemo(() => (
    <TransactionsMobileHeaderActions
      activeFilterCount={activeFilterCount}
      canWrite={canWriteTransactions}
      filterOpen={filterOpen}
      isBulkMode={isBulkMode}
      onCreate={() => setCreateStep(isMobile ? 'chooser' : 'transaction')}
      onToggleBulk={isBulkMode ? cancelBulkMode : enterBulkMode}
      onToggleFilter={() => (filterOpen ? closeFilter() : openFilter())}
    />
  ), [activeFilterCount, canWriteTransactions, cancelBulkMode, closeFilter, enterBulkMode, filterOpen, isBulkMode, isMobile, openFilter])

  useFiltersActive(activeTransactionFilterCount(filter, trimmedSearch))
  useMobileHeaderActions(mobileHeaderActions)

  function handleFilterDraftChange(nextFilter: TransactionsFilter) {
    const textChanged = draftFilter.merchantPrefix !== nextFilter.merchantPrefix || draftFilter.originalPrefix !== nextFilter.originalPrefix
    const nonTextChanged = didNonTextFilterChange(draftFilter, nextFilter)

    setDraftFilter(nextFilter)

    if (nonTextChanged) {
      setFilter(nextFilter)
      return
    }

    if (textChanged) {
      const startsSession = (!draftFilter.merchantPrefix && !!nextFilter.merchantPrefix)
        || (!draftFilter.originalPrefix && !!nextFilter.originalPrefix)
      setFilter(nextFilter, startsSession ? 'push' : 'replace')
    }
  }

  function handleClearFilters() {
    setDraftFilter(DEFAULT_TRANSACTION_FILTER)
    setSearch('')
    clearFilters()
  }

  function handleApplyMobileFilters(nextFilter: TransactionsFilter, nextSort: TransactionSort) {
    setDraftFilter(nextFilter)
    setFilterAndSort(nextFilter, nextSort)
    closeFilter()
  }

  const activePills = (size: 'sm' | 'md') => (
    <TransactionActivePills
      allCount={allSummary.summary?.totalCount}
      filter={draftFilter}
      lookups={lookups}
      now={now}
      onChange={handleFilterDraftChange}
      onSearchChange={setSearch}
      search={trimmedSearch}
      size={size}
      totalCount={summary.summary?.totalCount}
    />
  )
  const clearFiltersButton = <Button onClick={handleClearFilters} size="sm" variant="ghost">Clear filters</Button>

  return (
    <div className="flex flex-col gap-3" ref={pageRef}>
      {isMobile ? <h1 className="sr-only">Transactions</h1> : (
      <TransactionsHeader
        activeFilterCount={activeFilterCount}
        canWrite={canWriteTransactions}
        filter={filter}
        filtersButtonRef={filtersButtonRef}
        filtersOpen={desktopFiltersOpen}
        isBulkMode={isBulkMode}
        onCancelBulkMode={bulk.cancelBulkMode}
        onCreate={() => setCreateStep('transaction')}
        onEnterBulkMode={enterBulkMode}
        onImportSuccess={refetchTransactions}
        onToggleFilters={() => setDesktopFiltersOpen((open) => !open)}
        onToggleSummary={() => setSummaryOpen((open) => !open)}
        summaryAvailable={Boolean(summary.summary)}
        summaryOpen={summaryOpen}
      />
      )}

      {desktopFiltersOpen ? (
        <div className="hidden lg:block">
          <TransactionFilterPanel
            accounts={accounts}
            activeRow={activeFilterCount > 0 ? activePills('md') : undefined}
            caretRight={caretRight}
            categoryGroups={categoryGroups}
            clearable={activeFilterCount > 0}
            filter={draftFilter}
            now={now}
            onChange={handleFilterDraftChange}
            onClear={handleClearFilters}
            onRuleCreated={refetchTransactions}
            onSortChange={setSort}
            owners={owners}
            sort={sort}
            tags={tags}
          />
        </div>
      ) : null}

      {summary.summary ? <div className="order-3 lg:order-none"><TransactionSummaryCard open={summaryOpen} summary={summary.summary} /></div> : null}

      <div className="order-1 lg:order-none">
        <div className="flex items-center gap-2 lg:gap-3">
          {isBulkMode && canWriteTransactions ? (
            <BulkSelectAllCheckbox allSelected={allFilteredSelected} selecting={bulk.selectingAll} someSelected={someFilteredSelected} onToggle={bulk.toggleSelectAll} />
          ) : null}
          <SearchInput ariaLabel="Search transactions" className="flex-1" onChange={setSearch} placeholder="Search transactions..." size="lg" value={search} />
          <IconButton ariaLabel="Toggle summary" className="touch-manipulation lg:hidden" onClick={() => setSummaryOpen((open) => !open)} pressed={summaryOpen}>
            <BarChart3 className="h-4 w-4" />
          </IconButton>
        </div>
        {bulk.bulkSelectError ? <p className="mt-2 text-sm font-medium text-negative" role="alert">{bulk.bulkSelectError}</p> : null}
      </div>
      {activeFilterCount > 0 ? <div className="order-2 lg:hidden">{activePills('sm')}</div> : null}

      {isBulkMode ? (
        <BulkActionBar className="order-4 lg:order-none" selectedCount={selectedIds.size} onDelete={bulk.openBulkDelete} onEdit={bulk.openBulkEdit} />
      ) : null}

      <div aria-busy={transactions.fetching} aria-live="polite" className="order-5 lg:order-none">
        {transactions.fetching && transactions.transactions.length === 0 ? <LoadingSpinner label="Loading transactions" /> : null}
        {!transactions.fetching ? (
          <TransactionList
            categories={categories}
            emptyState={activeFilterCount > 0
              ? <EmptyState action={clearFiltersButton} title="No transactions match" description="Try changing or clearing filters." />
              : <EmptyState title="No transactions found" description="Transactions appear here once an account has synced." />}
            hasNextPage={transactions.hasNextPage}
            isBulkMode={isBulkMode}
            loadMore={transactions.loadMore}
            reexecuteQuery={transactions.reexecuteQuery}
            selectedIds={selectedIds}
            selectedTransactionId={selectedTransactionId}
            showTitle={false}
            sort={sort}
            toggleSelected={toggleSelected}
            transactions={transactions.transactions}
            onDetailsClose={() => navigate({ pathname: '/transactions', search: window.location.search })}
            onDetailsOpen={(transaction) => navigate({ pathname: `/transactions/${transaction.id}`, search: window.location.search })}
            onShowMerchant={(merchant) => handleFilterDraftChange({ ...draftFilter, merchantPrefix: merchant })}
          />
        ) : null}
      </div>

      {filterOpen && (
        <TransactionsMobileFilters
          filter={filter}
          now={now}
          sort={sort}
          onApply={handleApplyMobileFilters}
          onClear={() => { handleClearFilters(); closeFilter() }}
          onClose={closeFilter}
          onRuleCreated={refetchTransactions}
        />
      )}

      <TransactionsCreateFlow
        accounts={accounts}
        categories={categories}
        categoryGroups={categoryGroups}
        filter={draftFilter}
        onCreated={(transaction) => {
          setCreateStep(null)
          refetchTransactions()
          navigate({ pathname: `/transactions/${transaction.id}`, search: window.location.search })
        }}
        onRuleCreated={refetchTransactions}
        onStepChange={setCreateStep}
        step={createStep}
      />
      <BulkTransactionModals actions={bulk} categories={categories} selectedCount={selectedIds.size} tags={tags} />
    </div>
  )
}
