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
