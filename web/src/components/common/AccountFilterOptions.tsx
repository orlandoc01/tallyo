import { useState } from 'react'
import type { Account } from '../../types/graphql'
import { accountDisplayLabel, groupAccountsByInstitution } from '../../utils/accounts'
import { institutionColor } from '../../utils/colors'
import { allSelected, nextGroupSelectedIds, toggleSelectedIds } from '../../utils/selection'
import { FilterGroupRow, FilterOptionRow } from './FilterChip'
import { SearchInput } from './FormControls'

const SEARCHABLE_ACCOUNT_COUNT = 8

export function AccountFilterOptions({ accounts, selectedIds, onChange }: { accounts: Account[]; selectedIds: string[]; onChange: (ids: string[]) => void }) {
  const [search, setSearch] = useState('')
  const normalized = search.trim().toLowerCase()
  const allIds = accounts.map((account) => account.id)
  const everySelected = allSelected(selectedIds, allIds)
  const groups = groupAccountsByInstitution(accounts)
    .map((group) => ({ ...group, allIds: group.accounts.map((account) => account.id), accounts: group.accounts.filter((account) => !normalized || `${account.name} ${group.label}`.toLowerCase().includes(normalized)) }))
    .filter((group) => group.accounts.length > 0)

  return (
    <>
      {accounts.length > SEARCHABLE_ACCOUNT_COUNT ? <SearchInput ariaLabel="Account search" className="mb-1" onChange={setSearch} placeholder="Search accounts" value={search} /> : null}
      <div className="max-h-72 overflow-y-auto">
        <FilterOptionRow ariaLabel="Select all accounts" label="Select all" onToggle={() => onChange(nextGroupSelectedIds(selectedIds, allIds, !everySelected))} selected={everySelected} />
        {groups.map((group) => {
          const groupSelected = allSelected(selectedIds, group.allIds)
          return (
            <div key={group.key}>
              <FilterGroupRow
                ariaLabel={group.label}
                count={group.allIds.length}
                indeterminate={!groupSelected && group.allIds.some((id) => selectedIds.includes(id))}
                label={group.label}
                onToggle={() => onChange(nextGroupSelectedIds(selectedIds, group.allIds, !groupSelected))}
                selected={groupSelected}
              />
              {group.accounts.map((account) => (
                <FilterOptionRow
                  ariaLabel={accountDisplayLabel(account)}
                  key={account.id}
                  label={accountDisplayLabel(account)}
                  leading={<span aria-hidden className="h-5 w-5 shrink-0 rounded-full" style={{ backgroundColor: institutionColor(group.label) }} />}
                  onToggle={() => onChange(toggleSelectedIds(selectedIds, [account.id]))}
                  selected={selectedIds.includes(account.id)}
                />
              ))}
            </div>
          )
        })}
        {groups.length === 0 ? <p className="px-2 py-2 text-[13px] text-text-muted">No accounts found.</p> : null}
      </div>
    </>
  )
}
