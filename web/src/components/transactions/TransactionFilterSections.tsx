import type { ReactNode } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useAccounts, useCategoryGroups, useOwners } from '../../hooks/useEntityQueries'
import type { TransactionsFilter } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { CollapsibleFilterSection } from '../common/CollapsibleFilterSection'
import { FilterCheckboxList } from '../common/FilterCheckboxList'
import { selectionSummary } from '../common/filterSummary'
import { OwnerDot } from '../common/OwnerDot'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { AccountCheckboxList } from './AccountCheckboxList'
import { CategoryFilterOptions, DateFilterOptions } from './TransactionFilterOptions'
import { dateRangeSummary } from './transactionFilterPresets'

export interface FilterSectionProps {
  expanded: boolean
  filter: TransactionsFilter
  onChange: (filter: TransactionsFilter) => void
  onToggle: () => void
}

function Section({ active, children, expanded, label, onToggle, summary }: { active: boolean; children: ReactNode; expanded: boolean; label: string; onToggle: () => void; summary?: string }) {
  return <CollapsibleFilterSection active={active} expanded={expanded} label={label} summary={summary} onToggle={onToggle}>{children}</CollapsibleFilterSection>
}

export function DateSection({ active, expanded, filter, now, onChange, onToggle, summary }: FilterSectionProps & { active?: boolean; now: Date; summary?: string }) {
  return (
    <Section active={active ?? Boolean(filter.datetimeRange)} expanded={expanded} label="Date" onToggle={onToggle} summary={summary ?? dateRangeSummary(filter, now)}>
      <DateFilterOptions filter={filter} now={now} onChange={onChange} />
    </Section>
  )
}

export function CategorySection({ expanded, filter, onChange, onToggle }: FilterSectionProps) {
  const { categoryGroups } = useCategoryGroups()
  const ids = filter.categoryIds ?? []
  return (
    <Section active={ids.length > 0} expanded={expanded} label="Category" onToggle={onToggle} summary={selectionSummary(ids, (id) => categoryGroups.flatMap((group) => group.categories).find((category) => category.id === id)?.name)}>
      <CategoryFilterOptions categoryGroups={categoryGroups} filter={filter} onChange={onChange} />
    </Section>
  )
}

export function AccountSection({ expanded, filter, onChange, onToggle }: FilterSectionProps) {
  const { accounts } = useAccounts()
  const ids = filter.accountIds ?? []
  return (
    <Section active={ids.length > 0} expanded={expanded} label="Account" onToggle={onToggle} summary={selectionSummary(ids, (id) => { const account = accounts.find((item) => item.id === id); return account ? accountDisplayLabel(account) : undefined })}>
      <div className="max-h-72 overflow-auto">
        <AccountCheckboxList accounts={accounts} enableGroupToggle selectedAccountIds={filter.accountIds ?? undefined} onChange={(accountIds) => onChange({ ...filter, accountIds })} />
      </div>
    </Section>
  )
}

export function OwnerSection({ expanded, filter, onChange, onToggle }: FilterSectionProps) {
  const { hideOwners } = useAuth()
  const { owners } = useOwners()
  const ids = filter.ownerIds ?? []
  if (hideOwners) return null
  return (
    <Section active={ids.length > 0} expanded={expanded} label="Owner" onToggle={onToggle} summary={selectionSummary(ids, (id) => owners.find((owner) => owner.id === id)?.name)}>
      <FilterCheckboxList
        options={owners.map((owner) => ({ id: owner.id, label: owner.name, ariaLabel: owner.name, leading: <OwnerDot name={owner.name} /> }))}
        selectedIds={ids}
        onChange={(ownerIds) => onChange({ ...filter, ownerIds: ownerIds.length ? ownerIds : undefined })}
      />
    </Section>
  )
}

export function ShowHiddenRow({ filter, onChange }: Pick<FilterSectionProps, 'filter' | 'onChange'>) {
  return (
    <label className="flex min-h-[52px] items-center justify-between gap-3 border-t border-border text-sm font-medium text-text-1">
      Show hidden
      <ToggleSwitch checked={filter.isHidden !== false} label="Show hidden" onChange={(value) => onChange({ ...filter, isHidden: value ? undefined : false })} size="lg" />
    </label>
  )
}
