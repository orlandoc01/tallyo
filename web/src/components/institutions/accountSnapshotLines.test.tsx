import { describe, expect, it } from 'vitest'
import { assets } from '../../mocks/fixtures'
import { updateLineCash, updateLineQuantity, updateLineValue, type SnapshotLine } from './accountSnapshotLines'

const id = assets[1].id

function line(overrides: Partial<SnapshotLine>): SnapshotLine {
  return { asset: assets[1], manual: false, quantity: 0, quantityText: '0', valueUSD: 0, valueText: '0', price: 1, ...overrides }
}

describe('accountSnapshotLines rounding', () => {
  it('rounds a derived valuation to cents so it matches the wire', () => {
    expect(1.1 * 3).not.toBe(3.3) // sanity: IEEE-754 noise exists without rounding
    const [updated] = updateLineQuantity([line({ price: 3 })], id, '1.1')
    expect(updated.valueUSD).toBe(3.3)
    expect(updated.valueText).toBe('3.3')
  })

  it('trims IEEE-754 noise from a derived quantity', () => {
    expect(100 / 3).not.toBe(33.3333333333) // sanity: raw division carries noise
    const [updated] = updateLineValue([line({ quantity: 1, price: 3 })], id, '100')
    expect(updated.quantity).toBe(33.3333333333)
    expect(updated.quantityText).toBe('33.3333333333')
    expect(updated.valueUSD).toBe(100)
  })

  it('keeps value-only holdings value-only with no derived quantity', () => {
    const [updated] = updateLineValue([line({ quantity: null, price: null })], id, '80000')
    expect(updated.valueUSD).toBe(80_000)
    expect(updated.quantity).toBeNull()
  })

  it('rounds a cash balance to cents', () => {
    const [updated] = updateLineCash([line({ price: 1 })], id, '500.999')
    expect(updated.valueUSD).toBe(501)
    expect(updated.quantity).toBe(501)
  })
})
