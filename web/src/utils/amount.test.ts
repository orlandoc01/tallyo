import { describe, expect, it } from 'vitest'
import { formatQuantity } from './amount'

describe('quantity formatting', () => {
  it('keeps ordinary quantities readable and uses scientific notation at extremes', () => {
    expect(formatQuantity(12_345.6789)).toBe('12,345.679')
    expect(formatQuantity(0.0000000123456789)).toBe('1.23457E-8')
    expect(formatQuantity(1_234_567_890_000)).toBe('1.23457E12')
  })
})
