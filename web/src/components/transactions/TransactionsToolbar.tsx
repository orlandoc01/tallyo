import { Plus } from 'lucide-react'
import { FilterDropdownShell } from '../common/FilterDropdownShell'
import { PageToolbar, PageToolbarActions, PageToolbarButton } from '../common/PageToolbar'
import { useAccounts, useCategoryGroups, useOwners, useTags } from '../../hooks/useEntityQueries'
import type { TransactionSort, TransactionsFilter, TransactionsSummary } from '../../types/graphql'
import { ImportExportMenu } from './ImportExportMenu'
import { TransactionFilters } from './TransactionFilters'
import { TransactionSummaryDropdown } from './TransactionSummary'

// Desktop toolbar for the transactions page: import/export, bulk-mode toggle,
// summary dropdown, the filter dropdown, and the create button. Fetches the
// filter option lists (accounts, category groups, owners, tags) itself.
export function TransactionsToolbar({
  activeFilterCount,
  canWrite,
  draftFilter,
  filter,
  isBulkMode,
  selectedCount,
  sort,
  summary,
  onCancelBulkMode,
  onClearFilters,
  onCreate,
  onEnterBulkMode,
  onFilterChange,
  onImportSuccess,
  onRuleCreated,
  onSortChange,
}: {
  activeFilterCount: number
  canWrite: boolean
  draftFilter: TransactionsFilter
  filter: TransactionsFilter
  isBulkMode: boolean
  selectedCount: number
  sort: TransactionSort
  summary: TransactionsSummary | null
  onCancelBulkMode: () => void
  onClearFilters: () => void
  onCreate: () => void
  onEnterBulkMode: () => void
  onFilterChange: (filter: TransactionsFilter) => void
  onImportSuccess: () => void
  onRuleCreated: () => void
  onSortChange: (sort: TransactionSort) => void
}) {
  const { accounts } = useAccounts()
  const { categoryGroups } = useCategoryGroups()
  const { owners, fetching: ownersFetching } = useOwners()
  const { tags } = useTags()

  return (
    <PageToolbar className="hidden lg:flex">
      <PageToolbarActions>
        <ImportExportMenu
          canImport={canWrite}
          filter={filter}
          onImportSuccess={onImportSuccess}
        />
        {canWrite ? (
          isBulkMode ? (
            <PageToolbarButton onClick={onCancelBulkMode} variant="primary">
              Edit {selectedCount}
            </PageToolbarButton>
          ) : (
            <PageToolbarButton onClick={onEnterBulkMode}>
              Edit Multiple
            </PageToolbarButton>
          )
        ) : null}
        <TransactionSummaryDropdown summary={summary} />
        <FilterDropdownShell
          activeFilterCount={activeFilterCount}
          buttonAriaLabel="Filters"
          buttonContent="Filters"
          dark
          panelClassName="absolute right-0 z-20 mt-2 w-96 rounded-2xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900"
          wrapperClassName="relative"
          onClear={onClearFilters}
        >
          <TransactionFilters
            accounts={accounts}
            categoryGroups={categoryGroups}
            className="bg-white dark:bg-neutral-900"
            filter={draftFilter}
            onChange={onFilterChange}
            onClear={onClearFilters}
            onRuleCreated={onRuleCreated}
            onSortChange={onSortChange}
            owners={owners}
            ownersFetching={ownersFetching}
            showTitle={false}
            sort={sort}
            tags={tags}
          />
        </FilterDropdownShell>
        {canWrite ? (
          <PageToolbarButton
            aria-label="Create transaction"
            onClick={onCreate}
            variant="primary"
          >
            <Plus className="h-4 w-4" />
            Create
          </PageToolbarButton>
        ) : null}
      </PageToolbarActions>
    </PageToolbar>
  )
}
