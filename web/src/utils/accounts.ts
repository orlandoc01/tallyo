import type { Account } from '../types/graphql'

/**
 * Returns the canonical list-item display string for an account.
 * Examples:
 *   "Chase Checking (...1234)"
 *   "Chase Checking (...1234) (CLOSED)"
 *   "Old Amex Gold"               ← manual account, no mask
 *   "Old Amex Gold (CLOSED)"
 */
export function accountDisplayLabel(account: Pick<Account, 'name' | 'mask' | 'closed'>): string {
  const base = accountMaskedName(account)
  return account.closed ? `${base} (CLOSED)` : base
}

/** Account name with its masked number suffix, e.g. "Chase Checking (...1234)". */
export function accountMaskedName(account: Pick<Account, 'name' | 'mask'>): string {
  return account.mask ? `${account.name} (...${account.mask})` : account.name
}

export function accountBalanceUSD(account: Pick<Account, 'latestSnapshot'>): number | null {
  return account.latestSnapshot?.balanceUSD ?? null
}

export function accountNetContributionUSD(account: Pick<Account, 'latestSnapshot'>): number | null {
  return account.latestSnapshot?.netContributionUSD ?? null
}

export function groupAccountsByInstitution(accounts: Account[]) {
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

export function accountInstitutionLabel(account: Pick<Account, 'connection'>) {
  return account.connection ? connectionProviderLabel(account.connection) : 'Manual'
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
