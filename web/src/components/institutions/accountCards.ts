import type { Account, Connection } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { formatAccountType } from '../../utils/accountSubtypes'
import { formatRelativeTime, isSyncStale } from '../../utils/dates'

export type SyncTone = 'positive' | 'warning'

export function syncChipStatus(isActive: boolean, lastSyncedAt: string | null | undefined, now = Date.now()): { text: string; tone: SyncTone } {
  if (!isActive) return { text: 'Disconnected', tone: 'warning' }
  if (!lastSyncedAt) return { text: 'not synced yet', tone: 'warning' }
  return { text: `synced ${formatRelativeTime(lastSyncedAt, now)}`, tone: isSyncStale(lastSyncedAt, now) ? 'warning' : 'positive' }
}

export type InstitutionEntry = { connection: Connection; name: string; accounts: Account[] }

// One entry per provider-backed connection; the EVM wallet account lives on
// the accounts list rather than on the provider.
export function institutionEntries(connections: Connection[], accounts: Account[]): InstitutionEntry[] {
  return connections.flatMap((connection) => {
    const provider = connection.provider
    if (!provider) return []
    const name = connection.name || 'Unknown Institution'
    const connectionAccounts = 'accounts' in provider ? provider.accounts : accounts.filter((account) => account.connection?.id === connection.id)
    return [{ connection, name, accounts: connectionAccounts }]
  })
}

export function searchInstitutionEntries(query: string, entries: InstitutionEntry[]): InstitutionEntry[] {
  return entries.flatMap((entry) => {
    const matching = searchAccounts(query, entry.name, entry.accounts)
    return matching ? [{ ...entry, accounts: matching }] : []
  })
}

export function accountNumberLabel(mask: string | null | undefined) {
  return mask ? `···· ${mask}` : '—'
}

export function accountTypeLabel(account: Pick<Account, 'type' | 'subtype'>) {
  const type = formatAccountType(account.type)
  return account.subtype ? `${type} · ${titleCase(account.subtype)}` : type
}

export function accountRowLabel(account: Pick<Account, 'name' | 'mask' | 'closed' | 'hidden'>) {
  const label = accountDisplayLabel(account)
  return account.hidden ? `${label} (HIDDEN)` : label
}

function accountStatusRank(account: Pick<Account, 'closed' | 'hidden'>) {
  if (account.closed) return 2
  if (account.hidden) return 1
  return 0
}

export function sortAccountsByStatus<T extends Pick<Account, 'closed' | 'hidden'>>(accounts: T[]): T[] {
  return [...accounts].sort((left, right) => accountStatusRank(left) - accountStatusRank(right))
}

// Returns the accounts an institution card should list for a search query, or
// null when the card should be hidden entirely. A query matching the
// institution name keeps every account.
export function searchAccounts<T extends Pick<Account, 'name' | 'mask'>>(query: string, institutionName: string, accounts: T[]): T[] | null {
  const normalized = query.trim().toLowerCase()
  if (!normalized || institutionName.toLowerCase().includes(normalized)) return accounts
  const matching = accounts.filter((account) => account.name.toLowerCase().includes(normalized) || (account.mask?.includes(normalized) ?? false))
  return matching.length > 0 ? matching : null
}

export function titleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase())
}
