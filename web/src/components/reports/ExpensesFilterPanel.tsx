import { useState, type ReactNode } from 'react'
import type { Account, CategoryGroup, Owner, TransactionsFilter } from '../../types/graphql'
import { Button } from '../common/Button'
import { FilterDropdown } from '../common/FilterChip'
import { FilterPanel } from '../common/FilterPanel'
import { CreateRuleModal } from '../transactions/CreateRuleModal'
import { AccountChip, CategoryChip, OwnerChip } from '../transactions/TransactionFilterChips'
import { DateFilterOptions } from '../transactions/TransactionFilterOptions'
import { ShowHiddenToggle } from '../transactions/TransactionFilterPanel'
import { dateRangeSummary } from '../transactions/transactionFilterPresets'

export function ExpensesFilterPanel({ accounts, activeRow, caretRight, categoryGroups, clearable, dateFiltered, filter, now, onChange, onClear, onRuleCreated, owners, showDate }: {
  accounts: Account[]
  activeRow?: ReactNode
  caretRight?: number
  categoryGroups: CategoryGroup[]
  clearable: boolean
  dateFiltered: boolean
  filter: TransactionsFilter
  now: Date
  onChange: (filter: TransactionsFilter) => void
  onClear: () => void
  onRuleCreated: () => void
  owners: Owner[]
  showDate: boolean
}) {
  const [isCreateRuleOpen, setIsCreateRuleOpen] = useState(false)

  return (
    <FilterPanel
      actions={<ShowHiddenToggle filter={filter} onChange={onChange} />}
      activeRow={activeRow}
      caretRight={caretRight}
      clearable={clearable}
      onClear={onClear}
      trailing={<Button onClick={() => setIsCreateRuleOpen(true)} size="sm" variant="outline-accent">Create rule from filters</Button>}
      variant="inset-2"
    >
      {showDate ? (
        <FilterDropdown active={dateFiltered} label="Date" summary={dateFiltered ? dateRangeSummary(filter, now) ?? 'All time' : undefined} width={300}>
          {(close) => <DateFilterOptions filter={filter} now={now} onChange={onChange} onPresetSelect={close} />}
        </FilterDropdown>
      ) : null}
      <CategoryChip categoryGroups={categoryGroups} filter={filter} onChange={onChange} />
      <AccountChip accounts={accounts} filter={filter} onChange={onChange} />
      <OwnerChip filter={filter} onChange={onChange} owners={owners} />
      {isCreateRuleOpen ? (
        <CreateRuleModal accounts={accounts} categoryGroups={categoryGroups} filter={filter} onClose={() => setIsCreateRuleOpen(false)} onCreated={onRuleCreated} />
      ) : null}
    </FilterPanel>
  )
}
