import { describe, expect, it } from 'vitest'
import type { Account } from '../types/graphql'
import { accounts } from '../mocks/fixtures'
import { accountDisplayLabel, groupAccountsByInstitution } from './accounts'

describe('accountDisplayLabel', () => {
  it('includes mask when present', () => {
    expect(accountDisplayLabel({ name: 'Checking', mask: '1234', closed: false })).toBe('Checking (...1234)')
  })

  it('omits mask when absent', () => {
    expect(accountDisplayLabel({ name: 'Old Amex Gold', mask: null, closed: false })).toBe('Old Amex Gold')
  })

  it('appends (CLOSED) when account is closed and has a mask', () => {
    expect(accountDisplayLabel({ name: 'Savings', mask: '5678', closed: true })).toBe('Savings (...5678) (CLOSED)')
  })

  it('appends (CLOSED) when account is closed and has no mask', () => {
    expect(accountDisplayLabel({ name: 'Old Card', mask: null, closed: true })).toBe('Old Card (CLOSED)')
  })
})

describe('groupAccountsByInstitution', () => {
  const withConnection = (id: string, connection: Account['connection']): Account => ({ ...accounts[0], id, connection })

  it('labels unnamed connections by provider and puts manual accounts last', () => {
    const manual = withConnection('manual', null)
    const wallet = withConnection('wallet', { id: 'c-wallet', name: '', owner: accounts[0].owner, isActive: true, provider: { __typename: 'EVMWallet', address: '0x0', chainIds: ['eth'] } })
    const unnamed = withConnection('unnamed', { id: 'c-unnamed', name: '', owner: accounts[0].owner, isActive: true, provider: null })

    const groups = groupAccountsByInstitution([manual, wallet, unnamed, accounts[0]])

    expect(groups.map((group) => group.label)).toEqual(['Crypto wallet', 'Connected accounts', 'American Express', 'Manual'])
    expect(groups.at(-1)?.isManual).toBe(true)
  })
})
