import { describe, expect, it } from 'vitest'
import type {
  Account,
  Connection,
  Owner,
  PlaidCredential,
  PlaidItem,
  SimpleFinConnection,
} from '../../types/graphql'
import { accountNeedsReview, needsConnectionReview } from './connectionReview'

const owner: Owner = { __typename: 'Owner', id: 'owner-1', name: 'Alex' }

const credential: PlaidCredential = {
  __typename: 'PlaidCredential',
  id: 1,
  clientId: 'client-1',
  environment: 'DEVELOPMENT',
  label: 'Primary',
  itemCount: 1,
  createdAt: '2026-05-01T00:00:00Z',
}

describe('connection review predicates', () => {
  it('requires review for visible flagged accounts', () => {
    expect(accountNeedsReview(account({ needsReview: true }))).toBe(true)
    expect(accountNeedsReview(account({ needsReview: true, closed: true }))).toBe(false)
    expect(accountNeedsReview(account({ needsReview: true, hidden: true }))).toBe(false)
  })

  it('includes active unhealthy Plaid connections', () => {
    expect(needsConnectionReview(connection(plaidItem({ healthState: 'LINK_UPDATE_REQUIRED' })))).toBe(true)
    expect(needsConnectionReview(connection(plaidItem({ healthState: 'HEALTHY' })))).toBe(false)
    expect(needsConnectionReview(
      connection(plaidItem({ healthState: 'SYNC_ERROR' }), { isActive: false }),
    )).toBe(false)
  })

  it('includes active Plaid and SimpleFIN connections with flagged accounts', () => {
    const flagged = account({ needsReview: true })

    expect(needsConnectionReview(
      connection(plaidItem({ healthState: 'HEALTHY', accounts: [flagged] })),
    )).toBe(true)
    expect(needsConnectionReview(connection(simpleFinConnection([flagged])))).toBe(true)
    expect(needsConnectionReview(connection(simpleFinConnection([account({ needsReview: false })])))).toBe(false)
  })
})

function account(overrides: Partial<Account> = {}): Account {
  return {
    __typename: 'Account',
    id: 'account-1',
    connection: null,
    owner,
    name: 'Mystery Account',
    type: 'CREDIT',
    subtype: null,
    mask: null,
    notes: null,
    closed: false,
    hidden: false,
    needsReview: false,
    manual: false,
    typeLocked: false,
    lastSyncedAt: null,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    latestSnapshot: null,
    accountWealthProperty: null,
    ...overrides,
  }
}

function connection(provider: Connection['provider'], overrides: Partial<Connection> = {}): Connection {
  return {
    __typename: 'Connection',
    id: 'connection-1',
    name: 'Institution',
    owner,
    isActive: true,
    provider,
    ...overrides,
  }
}

function plaidItem(overrides: Partial<PlaidItem> = {}): PlaidItem {
  return {
    __typename: 'PlaidItem',
    id: 'item-1',
    credential,
    institutionId: 'ins_1',
    accounts: [],
    lastSyncedAt: null,
    healthState: 'HEALTHY',
    healthErrorCode: null,
    healthErrorMessage: null,
    healthUpdatedAt: null,
    syncCron: '0 6,18 * * *',
    recurringSyncCron: '0 12 * * 0',
    nextSyncAt: null,
    nextRecurringSyncAt: null,
    isActive: true,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

function simpleFinConnection(accounts: Account[]): SimpleFinConnection {
  return {
    __typename: 'SimpleFinConnection',
    id: 'simplefin-1',
    orgDomain: 'bank.example',
    orgUrl: 'https://bank.example',
    accounts,
    lastSyncedAt: null,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
  }
}
