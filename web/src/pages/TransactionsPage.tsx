import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { EmptyState } from '../components/common/EmptyState'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { MobileFilterDropdown } from '../components/common/MobileFilterDropdown'
import { PageHeader } from '../components/common/PageHeader'
import { SearchInput } from '../components/common/FormControls'
import { BulkActionBar, BulkSelectAllCheckbox, BulkTransactionModals } from '../components/transactions/BulkTransactionsUI'
import { CreateTransactionModal } from '../components/transactions/CreateTransactionModal'
import { TransactionList } from '../components/transactions/TransactionList'
import { TransactionsMobileFilters } from '../components/transactions/TransactionsMobileFilters'
import { TransactionsMobileHeaderActions } from '../components/transactions/TransactionsMobileHeaderActions'
import { TransactionsToolbar } from '../components/transactions/TransactionsToolbar'
import { TransactionSummaryCard } from '../components/transactions/TransactionSummary'
import { useBulkTransactionActions } from '../components/transactions/useBulkTransactionActions'
import { useMobileHeader, useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { useTransactionSelection } from '../components/transactions/useTransactionSelection'
import { useAccounts, useCategories, useTags } from '../hooks/useEntityQueries'
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
  const { tags } = useTags()
  const {
    closeFilter,
    filterOpen,
    filtersActive,
    openFilter,
  } = useMobileHeader()
  const { enterBulkMode, isBulkMode, selectedIds, toggleSelected } = useTransactionSelection()
  const { canWrite } = usePermissions()
  const canWriteTransactions = canWrite('transactions')

  const [draftFilter, setDraftFilter] = useState<TransactionsFilter>(filter)
  const [search, setSearch] = useQueryParamState('q')
  const [showCreate, setShowCreate] = useState(false)
  const [showMobileSummary, setShowMobileSummary] = useState(false)
  const trimmedSearch = search.trim()
  const summaryFilter = useMemo(() => trimmedSearch ? { ...draftFilter, search: trimmedSearch } : draftFilter, [draftFilter, trimmedSearch])

  const transactions = usePaginatedTransactions(draftFilter, sort, 50, trimmedSearch || undefined)
  const summary = useTransactionsSummary(summaryFilter)
  const refetchTransactions = () => transactions.reexecuteQuery({ requestPolicy: 'network-only' })
  const bulk = useBulkTransactionActions({ filter: summaryFilter, sort, refetch: refetchTransactions })
  const filteredTotalCount = summary.summary?.totalCount ?? 0
  const allFilteredSelected = filteredTotalCount > 0 && selectedIds.size === filteredTotalCount
  const someFilteredSelected = selectedIds.size > 0 && selectedIds.size < filteredTotalCount

  useEffect(() => {
    setDraftFilter(filter)
  }, [filter])

  const { cancelBulkMode } = bulk
  const summaryAvailable = Boolean(summary.summary)
  const mobileHeaderActions = useMemo(() => (
    <TransactionsMobileHeaderActions
      canWrite={canWriteTransactions}
      filterOpen={filterOpen}
      filtersActive={filtersActive}
      isBulkMode={isBulkMode}
      showCreate={showCreate}
      showMobileSummary={showMobileSummary}
      summaryAvailable={summaryAvailable}
      onCreate={() => setShowCreate(true)}
      onToggleBulk={isBulkMode ? cancelBulkMode : enterBulkMode}
      onToggleFilter={() => {
        setShowMobileSummary(false)
        if (filterOpen) closeFilter()
        else openFilter()
      }}
      onToggleSummary={() => {
        closeFilter()
        setShowMobileSummary((open) => !open)
      }}
    />
  ), [canWriteTransactions, cancelBulkMode, closeFilter, enterBulkMode, filterOpen, filtersActive, isBulkMode, openFilter, showCreate, showMobileSummary, summaryAvailable])

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

  return (
    <div className="space-y-4">
      <PageHeader
        actions={(
          <TransactionsToolbar
            activeFilterCount={activeTransactionFilterCount(draftFilter, trimmedSearch)}
            canWrite={canWriteTransactions}
            draftFilter={draftFilter}
            filter={filter}
            isBulkMode={isBulkMode}
            selectedCount={selectedIds.size}
            sort={sort}
            summary={summary.summary}
            onCancelBulkMode={bulk.cancelBulkMode}
            onClearFilters={handleClearFilters}
            onCreate={() => setShowCreate(true)}
            onEnterBulkMode={enterBulkMode}
            onFilterChange={handleFilterDraftChange}
            onImportSuccess={refetchTransactions}
            onRuleCreated={refetchTransactions}
            onSortChange={setSort}
          />
        )}
        title="Transactions"
      />

      <div aria-busy={transactions.fetching} aria-live="polite">
        <div className="mb-4">
          <div className="flex items-center gap-3">
            {isBulkMode && canWriteTransactions ? (
              <BulkSelectAllCheckbox
                allSelected={allFilteredSelected}
                selecting={bulk.selectingAll}
                someSelected={someFilteredSelected}
                onToggle={bulk.toggleSelectAll}
              />
            ) : null}
            <SearchInput ariaLabel="Search transactions" className="flex-1" onChange={setSearch} placeholder="Search transactions..." value={search} />
          </div>
          {bulk.bulkSelectError ? <p className="mt-2 text-sm font-medium text-red-600" role="alert">{bulk.bulkSelectError}</p> : null}
        </div>
        {transactions.fetching && transactions.transactions.length === 0 ? <LoadingSpinner label="Loading transactions" /> : null}
        {!transactions.fetching ? (
          <TransactionList
            categories={categories}
            emptyState={<EmptyState title="No transactions found" description="Try changing or clearing filters." />}
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
          />
        ) : null}
      </div>

      {isBulkMode ? (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onDelete={bulk.openBulkDelete}
          onEdit={bulk.openBulkEdit}
        />
      ) : null}

      {showMobileSummary && summary.summary ? (
        <MobileFilterDropdown
          bodyClassName="p-3"
          labelledBy="transaction-summary-title"
          onClose={() => setShowMobileSummary(false)}
          title="Summary"
        >
          <TransactionSummaryCard className="rounded-2xl border border-neutral-200 bg-white p-4" showTitle={false} summary={summary.summary} />
        </MobileFilterDropdown>
      ) : null}

      {filterOpen && (
        <TransactionsMobileFilters
          filter={filter}
          sort={sort}
          onApply={handleApplyMobileFilters}
          onClear={() => { handleClearFilters(); closeFilter() }}
          onClose={closeFilter}
          onRuleCreated={refetchTransactions}
        />
      )}

      {showCreate ? (
        <CreateTransactionModal
          accounts={accounts}
          categories={categories}
          onClose={() => setShowCreate(false)}
          onCreated={(transaction) => {
            setShowCreate(false)
            refetchTransactions()
            navigate({ pathname: `/transactions/${transaction.id}`, search: window.location.search })
          }}
        />
      ) : null}
      <BulkTransactionModals actions={bulk} categories={categories} selectedCount={selectedIds.size} tags={tags} />
    </div>
  )
}
