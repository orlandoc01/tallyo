import { useAuth } from '../../auth/useAuth'
import type { Account } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import type { FilterCheckboxGroup } from '../common/FilterCheckboxList'
import { SearchableGroupedFilterCheckboxList } from '../common/SearchableFilterCheckboxList'

export function AccountCheckboxList({
  accounts,
  selectedAccountIds,
  onChange,
  enableGroupToggle = false,
}: {
  accounts: Account[]
  selectedAccountIds?: string[]
  onChange: (accountIds: string[] | undefined) => void
  variant?: 'default' | 'highlight'
  enableGroupToggle?: boolean
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
      leading: hideOwners ? undefined : (
        <span aria-hidden="true" className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${ownerBadgeClass(account.owner.name)}`}>
          {account.owner.name.charAt(0).toUpperCase()}
        </span>
      ),
    })),
  }))

  return (
    <SearchableGroupedFilterCheckboxList
      className="space-y-3"
      emptyMessage="No accounts found."
      groups={checkboxGroups}
      groupSelection={enableGroupToggle ? 'toggle' : 'heading'}
      optionsClassName="space-y-2.5"
      searchLabel="Account search"
      searchPlaceholder="Search accounts"
      selectAllAriaLabel="Select all accounts"
      selectedIds={selectedIds}
      onChange={handleChange}
    />
  )
}

function groupAccountsByInstitution(accounts: Account[]) {
  const grouped = accounts.reduce<Record<string, { key: string; label: string; accounts: Account[]; isManual: boolean }>>((groups, account) => {
    const connection = account.connection
    if (!connection) {
      const group = groups['manual'] ?? { key: 'manual', label: 'Manual', accounts: [], isManual: true }
      return { ...groups, manual: { ...group, accounts: [...group.accounts, account] } }
    }

    const key = connection.id
    const label = connectionProviderLabel(connection)
    const group = groups[key] ?? { key, label, accounts: [], isManual: false }
    return { ...groups, [key]: { ...group, accounts: [...group.accounts, account] } }
  }, {})

  return Object.values(grouped).sort((a, b) => Number(a.isManual) - Number(b.isManual))
}

function connectionProviderLabel(connection: NonNullable<Account['connection']>) {
  if (connection.name) {
    return connection.name
  }
  const provider = connection.provider
  if (provider && 'address' in provider) {
    return 'Crypto wallet'
  }
  return 'Connected accounts'
}

function ownerBadgeClass(owner: string) {
  const colors = ['bg-blue-600', 'bg-emerald-600', 'bg-purple-600', 'bg-amber-600', 'bg-pink-600', 'bg-cyan-700']
  const index = [...owner].reduce((total, char) => total + char.charCodeAt(0), 0) % colors.length
  return colors[index]
}
