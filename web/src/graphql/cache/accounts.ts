// Cache updates for the linked-accounts subsystem: the accounts list and the
// connection/Plaid-item lists that embed those accounts. These three caches are
// updated together (an account upsert must reach every list that holds it), so
// they live in one module rather than being split into shallow per-list files.

import type { Account, Connection, PlaidItem } from '../../types/graphql'
import { ACCOUNTS_QUERY, CONNECTIONS_QUERY, PLAID_ITEMS_QUERY } from '../queries'
import { ACCOUNT_DERIVED_ROOTS, ACCOUNT_ROOTS, invalidateRoot, invalidateRoots, LINKED_ACCOUNT_ROOTS, mapCachedList, mapEachCachedList, replaceOrAppendByID, TRANSACTION_DERIVED_ROOTS, WEALTH_RESOLUTION_ROOTS, type MutationUpdaters, type QueryCache } from './shared'

function includesInactive(input: unknown) {
  return !!input && typeof input === 'object' && (input as { includeInactive?: boolean | null }).includeInactive === true
}

function connectionMatchesInput(connection: Connection, input: unknown) {
  return includesInactive(input) || connection.isActive
}

function plaidItemMatchesInput(item: PlaidItem, input: unknown) {
  return includesInactive(input) || item.isActive
}

function mapProviderAccounts(connection: Connection, map: (accounts: Account[]) => Account[]) {
  const provider = connection.provider
  if (provider?.__typename !== 'PlaidItem' && provider?.__typename !== 'SimpleFinConnection') return connection
  return { ...connection, provider: { ...provider, accounts: map(provider.accounts) } }
}

function upsertAccountInConnectionProvider(connection: Connection, account: Account) {
  if (connection.id !== account.connection?.id) return connection
  return mapProviderAccounts(connection, (accounts) => replaceOrAppendByID(accounts, account))
}

function removeAccountFromConnectionProvider(connection: Connection, accountID: string) {
  return mapProviderAccounts(connection, (accounts) => accounts.filter((account) => account.id !== accountID))
}

function removeConnectionAccountsFromConnectionProvider(connection: Connection, connectionID: string) {
  return mapProviderAccounts(connection, (accounts) => accounts.filter((account) => account.connection?.id !== connectionID))
}

function plaidItemOwnsAccount(item: PlaidItem, account: Account) {
  const connectionID = account.connection?.id
  return item.accounts.some((existing) => existing.id === account.id || (!!connectionID && existing.connection?.id === connectionID))
}

function upsertAccountInPlaidItem(item: PlaidItem, account: Account) {
  return plaidItemOwnsAccount(item, account)
    ? { ...item, accounts: replaceOrAppendByID(item.accounts, account) }
    : item
}

function removeAccountFromPlaidItem(item: PlaidItem, accountID: string) {
  return { ...item, accounts: item.accounts.filter((account) => account.id !== accountID) }
}

function removeConnectionAccountsFromPlaidItem(item: PlaidItem, connectionID: string) {
  return { ...item, accounts: item.accounts.filter((account) => account.connection?.id !== connectionID) }
}

function upsertPlaidItemInCachedConnections(cache: QueryCache, item: PlaidItem) {
  mapEachCachedList<Connection>(cache, 'connections', CONNECTIONS_QUERY, (connections) => {
    let changed = false
    const items = connections.map((connection) => {
      if (connection.provider?.__typename !== 'PlaidItem' || connection.provider.id !== item.id) return connection
      changed = true
      return { ...connection, provider: item }
    })
    return changed ? items : connections
  })
}

function upsertAccountInCachedConnections(cache: QueryCache, account: Account) {
  if (!account.connection?.id) return

  mapEachCachedList<Connection>(cache, 'connections', CONNECTIONS_QUERY, (items) => items.map((connection) => upsertAccountInConnectionProvider(connection, account)))
}

function removeAccountFromCachedConnections(cache: QueryCache, accountID: string) {
  mapEachCachedList<Connection>(cache, 'connections', CONNECTIONS_QUERY, (items) => items.map((connection) => removeAccountFromConnectionProvider(connection, accountID)))
}

function removeConnectionAccountsFromCachedConnections(cache: QueryCache, connectionID: string) {
  mapEachCachedList<Connection>(cache, 'connections', CONNECTIONS_QUERY, (items) => items.map((connection) => removeConnectionAccountsFromConnectionProvider(connection, connectionID)))
}

function upsertAccountInCachedPlaidItems(cache: QueryCache, account: Account) {
  if (!account.connection?.id) return

  mapEachCachedList<PlaidItem>(cache, 'plaidItems', PLAID_ITEMS_QUERY, (items) => items.map((item) => upsertAccountInPlaidItem(item, account)))
}

function removeAccountFromCachedPlaidItems(cache: QueryCache, accountID: string) {
  mapEachCachedList<PlaidItem>(cache, 'plaidItems', PLAID_ITEMS_QUERY, (items) => items.map((item) => removeAccountFromPlaidItem(item, accountID)))
}

function removeConnectionAccountsFromCachedPlaidItems(cache: QueryCache, connectionID: string) {
  mapEachCachedList<PlaidItem>(cache, 'plaidItems', PLAID_ITEMS_QUERY, (items) => items.map((item) => removeConnectionAccountsFromPlaidItem(item, connectionID)))
}

export function upsertAccountInCachedLists(cache: QueryCache, account: Account) {
  mapCachedList<Account>(cache, 'accounts', ACCOUNTS_QUERY, (items) => replaceOrAppendByID(items, account))
  upsertAccountInCachedConnections(cache, account)
  upsertAccountInCachedPlaidItems(cache, account)
}

function removeAccountFromCachedLists(cache: QueryCache, accountID: string) {
  mapCachedList<Account>(cache, 'accounts', ACCOUNTS_QUERY, (items) => items.filter((account) => account.id !== accountID))
  removeAccountFromCachedConnections(cache, accountID)
  removeAccountFromCachedPlaidItems(cache, accountID)
}

function removeConnectionAccountsFromCachedLists(cache: QueryCache, connectionID: string) {
  mapCachedList<Account>(cache, 'accounts', ACCOUNTS_QUERY, (items) => items.filter((account) => account.connection?.id !== connectionID))
  removeConnectionAccountsFromCachedConnections(cache, connectionID)
  removeConnectionAccountsFromCachedPlaidItems(cache, connectionID)
}

export function upsertConnectionInCachedLists(cache: QueryCache, connection: Connection) {
  mapEachCachedList<Connection>(cache, 'connections', CONNECTIONS_QUERY, (items, input) => (
    connectionMatchesInput(connection, input)
      ? replaceOrAppendByID(items, connection)
      : items.filter((item) => item.id !== connection.id)
  ))
}

function removeConnectionFromCachedLists(cache: QueryCache, connectionID: string) {
  mapEachCachedList<Connection>(cache, 'connections', CONNECTIONS_QUERY, (items) => items.filter((connection) => connection.id !== connectionID))
}

export function removeConnectionAndAccountsFromCachedLists(cache: QueryCache, connectionID: string) {
  removeConnectionFromCachedLists(cache, connectionID)
  removeConnectionAccountsFromCachedLists(cache, connectionID)
}

function upsertPlaidItemInCachedLists(cache: QueryCache, item: PlaidItem) {
  mapEachCachedList<PlaidItem>(cache, 'plaidItems', PLAID_ITEMS_QUERY, (items, input) => (
    plaidItemMatchesInput(item, input)
      ? replaceOrAppendByID(items, item)
      : items.filter((existing) => existing.id !== item.id)
  ))
  upsertPlaidItemInCachedConnections(cache, item)
}

export const accountMutationUpdaters = {
  exchangePublicToken(_result, _args, cache) {
    invalidateRoots(cache, ...LINKED_ACCOUNT_ROOTS)
  },
  createSimpleFinAccessToken(_result, _args, cache) {
    invalidateRoots(cache, 'simpleFinAccessTokens', ...ACCOUNT_ROOTS)
  },
  deleteSimpleFinAccessToken(_result, _args, cache) {
    invalidateRoots(cache, 'simpleFinAccessTokens', ...ACCOUNT_DERIVED_ROOTS, ...WEALTH_RESOLUTION_ROOTS)
  },
  resetSimpleFinSync(_result, _args, cache) {
    invalidateRoots(cache, 'simpleFinAccessTokens', 'connections')
  },
  completeLinkUpdate(_result, _args, cache) {
    invalidateRoots(cache, ...LINKED_ACCOUNT_ROOTS)
  },
  updateAccount(result, args, cache) {
    const account = (result as { updateAccount?: { account?: Account } }).updateAccount?.account
    if (account) {
      upsertAccountInCachedLists(cache, account)
    } else {
      invalidateRoots(cache, ...LINKED_ACCOUNT_ROOTS)
    }
    const input = args.input as { hidden?: boolean; closed?: boolean } | undefined
    if (input && ('hidden' in input || 'closed' in input)) {
      invalidateRoots(cache, 'transactions', ...TRANSACTION_DERIVED_ROOTS, ...WEALTH_RESOLUTION_ROOTS)
    }
  },
  removeManualAccount(_result, args, cache) {
    const accountID = (args.input as { id?: string } | undefined)?.id
    if (accountID) {
      removeAccountFromCachedLists(cache, accountID)
    } else {
      invalidateRoots(cache, ...ACCOUNT_ROOTS)
    }
    invalidateRoots(cache, 'transactions', ...TRANSACTION_DERIVED_ROOTS, ...WEALTH_RESOLUTION_ROOTS)
  },
  createManualAccount(result, _args, cache) {
    const account = (result as { createManualAccount?: { account?: Account } }).createManualAccount?.account
    if (account) {
      upsertAccountInCachedLists(cache, account)
    } else {
      invalidateRoots(cache, ...ACCOUNT_ROOTS)
    }
  },
  updateConnection(result, _args, cache) {
    const connection = (result as { updateConnection?: { connection?: Connection } }).updateConnection?.connection
    if (connection) {
      upsertConnectionInCachedLists(cache, connection)
      if (connection.provider?.__typename === 'PlaidItem') upsertPlaidItemInCachedLists(cache, connection.provider)
    } else {
      invalidateRoots(cache, ...LINKED_ACCOUNT_ROOTS)
    }
    invalidateRoots(cache, ...WEALTH_RESOLUTION_ROOTS)
  },
  deleteConnection(_result, args, cache) {
    const connectionID = (args.input as { connectionId?: string } | undefined)?.connectionId
    if (connectionID) {
      removeConnectionAndAccountsFromCachedLists(cache, connectionID)
    } else {
      invalidateRoots(cache, ...ACCOUNT_ROOTS)
    }
    invalidateRoots(cache, 'plaidItems', 'transactions', ...TRANSACTION_DERIVED_ROOTS, ...WEALTH_RESOLUTION_ROOTS)
  },
  createPlaidCredential(_result, _args, cache) {
    invalidateRoot(cache, 'plaidCredentials')
  },
  updatePlaidCredential(_result, _args, cache) {
    invalidateRoot(cache, 'plaidCredentials')
  },
  deletePlaidCredential(_result, _args, cache) {
    invalidateRoots(cache, 'plaidCredentials', 'plaidItems')
  },
} satisfies MutationUpdaters
