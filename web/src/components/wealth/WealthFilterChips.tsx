import { useAuth } from '../../auth/useAuth'
import type { Account, Owner } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { ASSET_ACCOUNT_GROUPS, visibleAccountCountsByGroup, visibleAccountCountsByOwner, type AccountGroupId } from '../../utils/accountGroups'
import { toggleSelectedIds } from '../../utils/selection'
import { AccountFilterOptions } from '../common/AccountFilterOptions'
import { selectionSummary } from '../common/filterSummary'
import { FilterDropdown, FilterOptionRow } from '../common/FilterChip'
import { OwnerDot } from '../common/OwnerDot'

export function OwnerChip({ accounts, owners, ownerIds, onChange }: { accounts: Account[]; owners: Owner[]; ownerIds: string[]; onChange: (ids: string[]) => void }) {
  const { hideOwners } = useAuth()
  if (hideOwners) return null
  const ownerCounts = visibleAccountCountsByOwner(accounts)
  return (
    <FilterDropdown active={ownerIds.length > 0} label="Owner" summary={selectionSummary(ownerIds, (id) => owners.find((owner) => owner.id === id)?.name)} width={220}>
      {owners.map((owner) => (
        <FilterOptionRow
          ariaLabel={owner.name}
          count={ownerCounts.get(owner.id) ?? 0}
          key={owner.id}
          label={owner.name}
          leading={<OwnerDot name={owner.name} />}
          onToggle={() => onChange(toggleSelectedIds(ownerIds, [owner.id]))}
          selected={ownerIds.includes(owner.id)}
        />
      ))}
    </FilterDropdown>
  )
}

export function AccountTypeChip({ accounts, accountGroupIds, onChange }: { accounts: Account[]; accountGroupIds: AccountGroupId[]; onChange: (ids: AccountGroupId[]) => void }) {
  const groupCounts = visibleAccountCountsByGroup(accounts)
  const accountGroups = ASSET_ACCOUNT_GROUPS
    .map((group) => ({ id: group.id, label: group.label, count: groupCounts.get(group.id) ?? 0 }))
    .filter((group) => group.count > 0)
  return (
    <FilterDropdown active={accountGroupIds.length > 0} label="Account type" summary={selectionSummary(accountGroupIds, (id) => accountGroups.find((group) => group.id === id)?.label)} width={240}>
      {accountGroups.map((group) => (
        <FilterOptionRow ariaLabel={group.label} count={group.count} key={group.id} label={group.label} onToggle={() => onChange(toggleSelectedIds(accountGroupIds, [group.id]))} selected={accountGroupIds.includes(group.id)} />
      ))}
    </FilterDropdown>
  )
}

export function AccountChip({ accounts, accountIds, onChange }: { accounts: Account[]; accountIds: string[]; onChange: (ids: string[]) => void }) {
  const visibleAccounts = accounts.filter((account) => !account.hidden)
  return (
    <FilterDropdown active={accountIds.length > 0} label="Account" summary={selectionSummary(accountIds, (id) => { const account = visibleAccounts.find((item) => item.id === id); return account && accountDisplayLabel(account) })} width={300}>
      <AccountFilterOptions accounts={visibleAccounts} selectedIds={accountIds} onChange={onChange} />
    </FilterDropdown>
  )
}
