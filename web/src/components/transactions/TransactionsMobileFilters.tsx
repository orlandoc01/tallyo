import { useState } from 'react'
import { MobileFilterDropdown } from '../common/MobileFilterDropdown'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { useAccounts, useCategoryGroups, useOwners, useTags } from '../../hooks/useEntityQueries'
import type { TransactionSort, TransactionsFilter } from '../../types/graphql'
import { TransactionFilters } from './TransactionFilters'

// Mobile filter overlay for the transactions page. Filter and sort edits are
// staged locally until Apply; the overlay unmounts when closed, so the staged
// state resets naturally. Fetches the filter option lists itself.
export function TransactionsMobileFilters({
  filter,
  sort,
  onApply,
  onClear,
  onClose,
  onRuleCreated,
}: {
  filter: TransactionsFilter
  sort: TransactionSort
  onApply: (filter: TransactionsFilter, sort: TransactionSort) => void
  onClear: () => void
  onClose: () => void
  onRuleCreated: () => void
}) {
  const { accounts } = useAccounts()
  const { categoryGroups } = useCategoryGroups()
  const { owners, fetching: ownersFetching } = useOwners()
  const { tags } = useTags()
  const [pendingFilter, setPendingFilter] = useState(filter)
  const [pendingSort, setPendingSort] = useState(sort)

  return (
    <MobileFilterDropdown
      footer={(
        <MobileFilterFooter
          onPrimary={() => onApply(pendingFilter, pendingSort)}
          onSecondary={onClear}
        />
      )}
      labelledBy="transaction-filters-title"
      onClose={onClose}
    >
      <TransactionFilters
        accounts={accounts}
        categoryGroups={categoryGroups}
        className="bg-white"
        filter={pendingFilter}
        onChange={setPendingFilter}
        onRuleCreated={onRuleCreated}
        onSortChange={setPendingSort}
        owners={owners}
        ownersFetching={ownersFetching}
        showTitle={false}
        sort={pendingSort}
        tags={tags}
      />
    </MobileFilterDropdown>
  )
}
