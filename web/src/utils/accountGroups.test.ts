import { describe, expect, it } from 'vitest'
import { isTaxAdvantagedAccount, isTaxAdvantagedSubtype, subtypesForAccountGroupIds, visibleAccountCountsByGroup, visibleAccountCountsByOwner } from './accountGroups'
import type { Account } from '../types/graphql'

describe('accountGroups', () => {
  it('detects tax advantaged accounts by subtype', () => {
    expect(isTaxAdvantagedSubtype('401k')).toBe(true)
    expect(isTaxAdvantagedSubtype('roth ira')).toBe(true)
    expect(isTaxAdvantagedSubtype('brokerage')).toBe(false)
    expect(isTaxAdvantagedSubtype(null)).toBe(false)

    expect(isTaxAdvantagedAccount({ subtype: 'hsa' } as Account)).toBe(true)
  })

  it('expands account groups into subtype filters', () => {
    expect(subtypesForAccountGroupIds(['TAX_ADVANTAGED'])).toContain('401k')
    expect(subtypesForAccountGroupIds(['INVESTMENTS'])).toContain('brokerage')
    expect(subtypesForAccountGroupIds(['INVESTMENTS'])).not.toContain('401k')
    expect(subtypesForAccountGroupIds(['DEPOSITS'])).toContain('checking')
    expect(subtypesForAccountGroupIds(['REAL_ESTATE'])).toEqual([])
    expect(subtypesForAccountGroupIds(['CRYPTO_WALLETS'])).toEqual([])
    expect(subtypesForAccountGroupIds(['OTHER_ASSETS'])).toContain('other')
  })

  it('counts visible accounts by group and by owner', () => {
    const accounts = [
      { id: 'a', type: 'DEPOSITORY', subtype: 'checking', hidden: false, owner: { id: 'o1' } },
      { id: 'b', type: 'INVESTMENT', subtype: 'roth ira', hidden: false, owner: { id: 'o1' } },
      { id: 'c', type: 'INVESTMENT', subtype: 'brokerage', hidden: true, owner: { id: 'o2' } },
    ] as Account[]

    const groupCounts = visibleAccountCountsByGroup(accounts)
    expect([groupCounts.get('DEPOSITS'), groupCounts.get('TAX_ADVANTAGED'), groupCounts.get('INVESTMENTS')]).toEqual([1, 1, 0])
    expect([...visibleAccountCountsByOwner(accounts)]).toEqual([['o1', 2]])
  })
})
