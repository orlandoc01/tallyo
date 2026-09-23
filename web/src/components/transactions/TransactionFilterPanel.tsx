import { useState, type ReactNode } from 'react'
import type { Account, CategoryGroup, Owner, Tag, TransactionSort, TransactionsFilter } from '../../types/graphql'
import { Button } from '../common/Button'
import { FilterDropdown, FilterOptionRow } from '../common/FilterChip'
import { FilterPanel } from '../common/FilterPanel'
import { selectionSummary } from '../common/filterSummary'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { CreateRuleModal } from './CreateRuleModal'
import { AccountChip, CategoryChip, OwnerChip } from './TransactionFilterChips'
import { AmountFilterOptions, DateFilterOptions, SortOptions, TagFilterOptions, TextFilterFields } from './TransactionFilterOptions'
import { SORT_OPTIONS, amountSummary, dateRangeSummary, sortId } from './transactionFilterPresets'

export function ShowHiddenToggle({ filter, onChange }: { filter: TransactionsFilter; onChange: (filter: TransactionsFilter) => void }) {
  return (
    <label className="mr-1 flex items-center gap-2 text-[13px] text-text-3">
      <ToggleSwitch checked={filter.isHidden !== false} label="Show hidden" onChange={(value) => onChange({ ...filter, isHidden: value ? undefined : false })} />
      Show hidden
    </label>
  )
}

export function TransactionFilterPanel({ accounts, activeRow, caretRight, categoryGroups, clearable, filter, now, onChange, onClear, onRuleCreated, onSortChange, owners, sort, tags }: {
  accounts: Account[]
  activeRow?: ReactNode
  caretRight?: number
  categoryGroups: CategoryGroup[]
  clearable: boolean
  filter: TransactionsFilter
  now: Date
  onChange: (filter: TransactionsFilter) => void
  onClear: () => void
  onRuleCreated: () => void
  onSortChange: (sort: TransactionSort) => void
  owners: Owner[]
  sort: TransactionSort
  tags: Tag[]
}) {
  const [isCreateRuleOpen, setIsCreateRuleOpen] = useState(false)
  const tagIds = filter.tagIds ?? []
  const moreActive = sortId(sort) !== SORT_OPTIONS[0].id || Boolean(filter.merchantPrefix || filter.originalPrefix || filter.excludeTransfers)

  return (
    <FilterPanel
      actions={<ShowHiddenToggle filter={filter} onChange={onChange} />}
      activeRow={activeRow}
      caretRight={caretRight}
      clearable={clearable}
      onClear={onClear}
      trailing={<Button onClick={() => setIsCreateRuleOpen(true)} size="sm" variant="outline-accent">Create rule from filters</Button>}
      variant="card"
    >
      <FilterDropdown active={Boolean(filter.datetimeRange)} label="Date" summary={dateRangeSummary(filter, now)} width={300}>
        {(close) => <DateFilterOptions filter={filter} now={now} onChange={onChange} onPresetSelect={close} />}
      </FilterDropdown>
      <CategoryChip categoryGroups={categoryGroups} filter={filter} onChange={onChange} />
      <AccountChip accounts={accounts} filter={filter} onChange={onChange} />
      <OwnerChip filter={filter} onChange={onChange} owners={owners} />
      <FilterDropdown active={Boolean(amountSummary(filter))} label="Amount" summary={amountSummary(filter)} width={300}>
        <AmountFilterOptions filter={filter} onChange={onChange} />
      </FilterDropdown>
      <FilterDropdown active={tagIds.length > 0 || filter.untagged === true} label="Tags" summary={filter.untagged ? 'Untagged' : selectionSummary(tagIds, (id) => tags.find((tag) => tag.id === id)?.name)} width={240}>
        <TagFilterOptions filter={filter} onChange={onChange} tags={tags} />
      </FilterDropdown>
      <FilterDropdown active={moreActive} label="More" width={240}>
        <div className="px-1 pb-1 text-[11px] font-medium uppercase tracking-[0.6px] text-text-muted">Sort</div>
        <SortOptions onSortChange={onSortChange} sort={sort} />
        <div className="mt-2 border-t border-border-strong pt-2">
          <TextFilterFields filter={filter} onChange={onChange} />
        </div>
        <div className="mt-2 border-t border-border-strong pt-1">
          <FilterOptionRow ariaLabel="Exclude transfers" label="Exclude transfers" onToggle={() => onChange({ ...filter, excludeTransfers: filter.excludeTransfers ? undefined : true })} selected={filter.excludeTransfers === true} />
        </div>
      </FilterDropdown>
      {isCreateRuleOpen ? (
        <CreateRuleModal accounts={accounts} categoryGroups={categoryGroups} filter={filter} onClose={() => setIsCreateRuleOpen(false)} onCreated={onRuleCreated} />
      ) : null}
    </FilterPanel>
  )
}
