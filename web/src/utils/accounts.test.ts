import { describe, expect, it } from 'vitest'
import { accountDisplayLabel } from './accounts'

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
