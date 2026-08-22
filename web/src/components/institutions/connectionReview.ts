import type { Account, Connection } from '../../types/graphql'

export function accountNeedsReview(account: Account) {
  return account.needsReview && !account.closed && !account.hidden
}

export function needsConnectionReview(connection: Connection) {
  if (!connection.isActive) return false

  const provider = connection.provider
  if (!provider) return false

  if (provider.__typename === 'PlaidItem') {
    return provider.healthState !== 'HEALTHY' || provider.accounts.some(accountNeedsReview)
  }
  if (provider.__typename === 'SimpleFinConnection') return provider.accounts.some(accountNeedsReview)
  return false
}
