import type { Cache } from '@urql/exchange-graphcache'
import type { Account, Connection } from '../../types/graphql'
import { removeConnectionAndAccountsFromCachedLists, upsertAccountInCachedLists, upsertConnectionInCachedLists } from './accounts'
import { ACCOUNT_ROOTS, WEALTH_RESOLUTION_ROOTS, invalidateRoot, invalidateRoots, type MutationUpdaters } from './shared'

// Shared by the wallet/real-estate link updaters: upsert what the payload
// returned, fall back to invalidation for whatever it omitted.
function applyLinkedConnectionPayload(cache: Cache, payload?: { account?: Account; connection?: Connection }) {
  if (payload?.connection) upsertConnectionInCachedLists(cache, payload.connection)
  if (payload?.account) upsertAccountInCachedLists(cache, payload.account)
  if (!payload?.connection || !payload?.account) {
    invalidateRoots(cache, ...ACCOUNT_ROOTS)
  }
  invalidateRoots(cache, ...WEALTH_RESOLUTION_ROOTS)
}

export const wealthMutationUpdaters = {
  updateAsset(_result, _args, cache) {
    invalidateRoots(cache, ...WEALTH_RESOLUTION_ROOTS)
  },
  createAsset(_result, _args, cache) {
    invalidateRoot(cache, 'assets')
  },
  mergeAsset(_result, _args, cache) {
    invalidateRoots(cache, ...WEALTH_RESOLUTION_ROOTS)
  },
  changeAccountSnapshot(_result, _args, cache) {
    invalidateRoots(cache, ...WEALTH_RESOLUTION_ROOTS)
  },
  linkEVMWallet(result, _args, cache) {
    applyLinkedConnectionPayload(cache, (result as { linkEVMWallet?: { account?: Account; connection?: Connection } }).linkEVMWallet)
  },
  linkRealEstate(result, _args, cache) {
    applyLinkedConnectionPayload(cache, (result as { linkRealEstate?: { account?: Account; connection?: Connection } }).linkRealEstate)
  },
  updateRealEstate(result, _args, cache) {
    const account = (result as { updateRealEstate?: { account?: Account } }).updateRealEstate?.account
    if (account) {
      upsertAccountInCachedLists(cache, account)
    } else {
      invalidateRoot(cache, 'accounts')
    }
    invalidateRoots(cache, ...WEALTH_RESOLUTION_ROOTS)
  },
  resolveBalanceReview(_result, _args, cache) {
    invalidateRoots(cache, ...WEALTH_RESOLUTION_ROOTS)
  },
  unlinkRealEstate(_result, args, cache) {
    const connectionID = typeof args.id === 'string' ? args.id : undefined
    if (connectionID) {
      removeConnectionAndAccountsFromCachedLists(cache, connectionID)
    } else {
      invalidateRoots(cache, ...ACCOUNT_ROOTS)
    }
    invalidateRoots(cache, ...WEALTH_RESOLUTION_ROOTS)
  },
  unlinkEVMWallet(_result, args, cache) {
    const connectionID = typeof args.id === 'string' ? args.id : undefined
    if (connectionID) {
      removeConnectionAndAccountsFromCachedLists(cache, connectionID)
    } else {
      invalidateRoots(cache, ...ACCOUNT_ROOTS)
    }
    invalidateRoots(cache, ...WEALTH_RESOLUTION_ROOTS)
  },
} satisfies MutationUpdaters
