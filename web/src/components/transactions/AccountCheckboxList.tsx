import { useAuth } from '../../auth/useAuth'
import type { Account } from '../../types/graphql'
import { accountDisplayLabel, groupAccountsByInstitution } from '../../utils/accounts'
import { OwnerDot } from '../common/OwnerDot'
import type { FilterCheckboxGroup } from '../common/FilterCheckboxList'
import { SearchableGroupedFilterCheckboxList } from '../common/SearchableFilterCheckboxList'

export function AccountCheckboxList({
  accounts,
  selectedAccountIds,
  onChange,
  enableGroupToggle = false,
  showCount = false,
}: {
  accounts: Account[]
  selectedAccountIds?: string[]
  onChange: (accountIds: string[] | undefined) => void
  variant?: 'default' | 'highlight'
  enableGroupToggle?: boolean
  showCount?: boolean
}) {
  const { hideOwners } = useAuth()
  const selectedIds = selectedAccountIds ?? []
  const visibleAccounts = accounts.filter((account) => !account.hidden)
  const groups = groupAccountsByInstitution(visibleAccounts)

  function handleChange(nextSelectedIds: string[]) {
    onChange(nextSelectedIds.length ? nextSelectedIds : undefined)
  }

  const checkboxGroups: FilterCheckboxGroup[] = groups.map(({ key, label, accounts }) => ({
    id: key,
    label,
    ariaLabel: label,
    summary: `${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'}`,
    searchText: label,
    options: accounts.map((account) => ({
      id: account.id,
      label: accountDisplayLabel(account),
      ariaLabel: accountDisplayLabel(account),
      searchText: `${account.name} ${accountDisplayLabel(account)}`,
      leading: hideOwners ? undefined : <OwnerDot name={account.owner.name} />,
    })),
  }))

  return (
    <SearchableGroupedFilterCheckboxList
      emptyMessage="No accounts found."
      groups={checkboxGroups}
      groupSelection={enableGroupToggle ? 'toggle' : 'heading'}
      searchLabel="Account search"
      searchPlaceholder="Search accounts"
      selectAllAriaLabel="Select all accounts"
      selectedIds={selectedIds}
      summary={showCount ? `${visibleAccounts.length} ${visibleAccounts.length === 1 ? 'account' : 'accounts'}` : undefined}
      onChange={handleChange}
    />
  )
}
