import { describe, expect, it } from 'vitest'
import type { Account, Connection } from '../../types/graphql'
import { accountNumberLabel, accountRowLabel, accountTypeLabel, institutionEntries, searchAccounts, searchInstitutionEntries, sortAccountsByStatus, syncChipStatus } from './accountCards'

const NOW = new Date('2026-09-20T12:00:00Z').getTime()

describe('syncChipStatus', () => {
  it('reports a healthy recent sync', () => {
    expect(syncChipStatus(true, '2026-09-15T12:00:00Z', NOW)).toEqual({ text: 'synced 5d ago', tone: 'positive' })
  })

  it('flags syncs older than 30 days, missing syncs, and disconnected connections', () => {
    expect(syncChipStatus(true, '2026-07-01T12:00:00Z', NOW)).toEqual({ text: 'synced 3mo ago', tone: 'warning' })
    expect(syncChipStatus(true, null, NOW)).toEqual({ text: 'not synced yet', tone: 'warning' })
    expect(syncChipStatus(false, '2026-09-19T12:00:00Z', NOW)).toEqual({ text: 'Disconnected', tone: 'warning' })
  })
})

describe('account row labels', () => {
  it('formats number, type and accessible labels', () => {
    expect(accountNumberLabel('1008')).toBe('···· 1008')
    expect(accountNumberLabel(null)).toBe('—')
    expect(accountTypeLabel({ type: 'CREDIT', subtype: 'credit card' })).toBe('Credit · Credit Card')
    expect(accountTypeLabel({ type: 'CRYPTO_WALLET', subtype: null })).toBe('Crypto Wallet')
    expect(accountRowLabel({ name: 'Savings', mask: '1234', closed: true, hidden: false })).toBe('Savings (...1234) (CLOSED)')
    expect(accountRowLabel({ name: 'Secret', mask: null, closed: false, hidden: true })).toBe('Secret (HIDDEN)')
  })
})

describe('sortAccountsByStatus', () => {
  it('orders active, hidden, then closed', () => {
    const sorted = sortAccountsByStatus([
      { id: 'closed', closed: true, hidden: false },
      { id: 'hidden', closed: false, hidden: true },
      { id: 'active', closed: false, hidden: false },
    ])
    expect(sorted.map((account) => account.id)).toEqual(['active', 'hidden', 'closed'])
  })
})

describe('searchAccounts', () => {
  const accounts = [
    { name: 'Checking', mask: '9625' },
    { name: 'Gold Card', mask: '1005' },
  ]

  it('keeps every account without a query or when the institution matches', () => {
    expect(searchAccounts('', 'Chase', accounts)).toBe(accounts)
    expect(searchAccounts('cha', 'Chase', accounts)).toBe(accounts)
  })

  it('narrows to matching names or masks and hides the card when nothing matches', () => {
    expect(searchAccounts('1005', 'Chase', accounts)).toEqual([accounts[1]])
    expect(searchAccounts('check', 'Chase', accounts)).toEqual([accounts[0]])
    expect(searchAccounts('zzz', 'Chase', accounts)).toBeNull()
  })
})

describe('institutionEntries', () => {
  const owner = { id: 'owner-1', name: 'alex' }
  const plaidAccount = { id: 'acct-1', name: 'Checking', mask: '9625' } as Account
  const walletAccount = { id: 'acct-evm', name: 'Main Wallet', mask: null, connection: { id: 'conn-evm', owner, isActive: true } } as Account
  const plaid: Connection = { id: 'conn-1', name: null, owner, isActive: true, provider: { __typename: 'PlaidItem', accounts: [plaidAccount] } as Connection['provider'] }
  const wallet: Connection = { id: 'conn-evm', name: 'Main Wallet', owner, isActive: true, provider: { __typename: 'EVMWallet', address: '0x0', chainIds: ['eth'] } }
  const home: Connection = { id: 'conn-re', name: 'Home', owner, isActive: true, provider: null }

  it('reads provider accounts, looks up wallet accounts, skips providerless connections and names unnamed ones', () => {
    expect(institutionEntries([plaid, wallet, home], [plaidAccount, walletAccount])).toEqual([
      { connection: plaid, name: 'Unknown Institution', accounts: [plaidAccount] },
      { connection: wallet, name: 'Main Wallet', accounts: [walletAccount] },
    ])
  })

  it('matches an unnamed connection by its fallback name and narrows accounts per entry', () => {
    const entries = institutionEntries([plaid, wallet], [walletAccount])
    expect(searchInstitutionEntries('unknown', entries)).toEqual([{ connection: plaid, name: 'Unknown Institution', accounts: [plaidAccount] }])
    expect(searchInstitutionEntries('9625', entries)).toEqual([{ connection: plaid, name: 'Unknown Institution', accounts: [plaidAccount] }])
    expect(searchInstitutionEntries('nope', entries)).toEqual([])
  })
})
