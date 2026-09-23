import { describe, expect, it } from 'vitest'
import { mobileTitle } from './mobileTitle'

describe('mobileTitle', () => {
  it('uses the nav item label for a section, including deep routes', () => {
    expect(mobileTitle('/net-worth')).toBe('Net Worth')
    expect(mobileTitle('/net-worth/accounts/acct-1/valuation')).toBe('Net Worth')
    expect(mobileTitle('/expenses/trends')).toBe('Expenses')
    expect(mobileTitle('/budgets/2026-09')).toBe('Budget')
  })

  it('titles the settings root and settings tabs', () => {
    expect(mobileTitle('/settings')).toBe('Settings')
    expect(mobileTitle('/settings/')).toBe('Settings')
    expect(mobileTitle('/settings/access')).toBe('Access')
    expect(mobileTitle('/settings/ai-integration')).toBe('AI Integration')
    expect(mobileTitle('/settings/unknown')).toBe('Settings')
  })

  it('falls back to an empty title for unmatched paths', () => {
    expect(mobileTitle('/')).toBe('')
    expect(mobileTitle('/nope')).toBe('')
  })
})
