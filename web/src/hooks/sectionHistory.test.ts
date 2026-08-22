import { describe, expect, it } from 'vitest'
import { isStickySection, loadHistory, persistHistory, sectionOf, STORAGE_KEY } from './sectionHistory'

describe('sectionHistory', () => {
  it('extracts the first path segment', () => {
    expect(sectionOf('/')).toBe('')
    expect(sectionOf('/expenses/breakdown')).toBe('expenses')
    expect(sectionOf('/expenses/')).toBe('expenses')
    expect(sectionOf('transactions/tx-1')).toBe('transactions')
  })

  it('identifies sticky sections', () => {
    expect(isStickySection('expenses')).toBe(true)
    expect(isStickySection('cash-flow')).toBe(true)
    expect(isStickySection('transactions')).toBe(true)
    expect(isStickySection('accounts')).toBe(true)
    expect(isStickySection('net-worth')).toBe(true)
    expect(isStickySection('portfolio')).toBe(true)
    expect(isStickySection('budgets')).toBe(false)
    expect(isStickySection('review')).toBe(false)
    expect(isStickySection('settings')).toBe(false)
  })

  it('loads only string values for sticky sections', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      expenses: '/expenses/breakdown?granularity=YEARLY',
      budgets: '/budgets/2026-06',
      accounts: 42,
      settings: '/settings/general',
      transactions: '/transactions/tx-1#notes',
    }))

    expect(loadHistory()).toEqual({
      expenses: '/expenses/breakdown?granularity=YEARLY',
      transactions: '/transactions/tx-1#notes',
    })
  })

  it('survives malformed storage', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')

    expect(loadHistory()).toEqual({})
  })

  it('persists a cleaned history map', () => {
    persistHistory({
      expenses: '/expenses/trends',
      budgets: '/budgets/2026-06',
      accounts: '/accounts/acct-1/balances',
    })

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      expenses: '/expenses/trends',
      accounts: '/accounts/acct-1/balances',
    })
    expect(loadHistory()).toEqual({
      expenses: '/expenses/trends',
      accounts: '/accounts/acct-1/balances',
    })
  })
})
