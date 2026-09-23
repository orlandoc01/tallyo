import { useAuth } from '../../auth/useAuth'
import type { Account, CategoryGroup, Owner, TransactionsFilter } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { toggleSelectedIds } from '../../utils/selection'
import { AccountFilterOptions } from '../common/AccountFilterOptions'
import { FilterDropdown, FilterOptionRow } from '../common/FilterChip'
import { selectionSummary } from '../common/filterSummary'
import { OwnerDot } from '../common/OwnerDot'
import { CategoryFilterOptions } from './TransactionFilterOptions'

interface ChipProps {
  filter: TransactionsFilter
  onChange: (filter: TransactionsFilter) => void
}

export function CategoryChip({ categoryGroups, filter, onChange }: ChipProps & { categoryGroups: CategoryGroup[] }) {
  const categoryIds = filter.categoryIds ?? []
  const categories = categoryGroups.flatMap((group) => group.categories)
  return (
    <FilterDropdown active={categoryIds.length > 0} label="Category" summary={selectionSummary(categoryIds, (id) => categories.find((category) => category.id === id)?.name)} width={300}>
      <CategoryFilterOptions categoryGroups={categoryGroups} filter={filter} onChange={onChange} />
    </FilterDropdown>
  )
}

export function AccountChip({ accounts, filter, onChange }: ChipProps & { accounts: Account[] }) {
  const accountIds = filter.accountIds ?? []
  const visibleAccounts = accounts.filter((account) => !account.hidden)
  return (
    <FilterDropdown active={accountIds.length > 0} label="Account" summary={selectionSummary(accountIds, (id) => { const account = visibleAccounts.find((item) => item.id === id); return account && accountDisplayLabel(account) })} width={320}>
      <AccountFilterOptions accounts={visibleAccounts} selectedIds={accountIds} onChange={(ids) => onChange({ ...filter, accountIds: ids.length ? ids : undefined })} />
    </FilterDropdown>
  )
}

export function OwnerIdsChip({ ownerIds, onChange, owners }: { ownerIds: string[]; onChange: (ids: string[]) => void; owners: Owner[] }) {
  const { hideOwners } = useAuth()
  if (hideOwners) return null
  return (
    <FilterDropdown active={ownerIds.length > 0} label="Owner" summary={selectionSummary(ownerIds, (id) => owners.find((owner) => owner.id === id)?.name)} width={220}>
      {owners.map((owner) => (
        <FilterOptionRow ariaLabel={owner.name} key={owner.id} label={owner.name} leading={<OwnerDot name={owner.name} />} onToggle={() => onChange(toggleSelectedIds(ownerIds, [owner.id]))} selected={ownerIds.includes(owner.id)} />
      ))}
    </FilterDropdown>
  )
}

export function OwnerChip({ filter, onChange, owners }: ChipProps & { owners: Owner[] }) {
  return <OwnerIdsChip onChange={(ids) => onChange({ ...filter, ownerIds: ids.length ? ids : undefined })} ownerIds={filter.ownerIds ?? []} owners={owners} />
}
