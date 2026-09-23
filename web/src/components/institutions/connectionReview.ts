import type { Account, Connection, PlaidItem, SimpleFinConnection } from '../../types/graphql'

export function accountNeedsReview(account: Account) {
  return account.needsReview && !account.closed && !account.hidden
}

export function reviewProvider(connection: Connection): PlaidItem | SimpleFinConnection | null {
  const provider = connection.provider
  if (!connection.isActive || !provider) return null
  if (provider.__typename === 'PlaidItem' && (provider.healthState !== 'HEALTHY' || provider.accounts.some(accountNeedsReview))) return provider
  if (provider.__typename === 'SimpleFinConnection' && provider.accounts.some(accountNeedsReview)) return provider
  return null
}

export function needsConnectionReview(connection: Connection) {
  return reviewProvider(connection) !== null
}

export function healthMessage(item: PlaidItem) {
  if (item.healthState === 'LINK_UPDATE_REQUIRED') return 'Plaid needs this institution to be reconnected.'
  return item.healthErrorMessage || item.healthErrorCode || 'Plaid sync is currently failing.'
}
