import { describe, expect, it } from 'vitest'
import { formatSignedCurrency, formatTransactionAmount, formatUnitPrice, transactionAmountClassName } from './currency'

describe('currency formatting', () => {
  it('formats spending amounts normally', () => {
    expect(formatTransactionAmount(123.45)).toBe('$123.45')
    expect(transactionAmountClassName(123.45)).toContain('text-neutral')
  })

  it('formats negative Plaid amounts as green credits', () => {
    expect(formatTransactionAmount(-52.12)).toBe('+$52.12')
    expect(transactionAmountClassName(-52.12)).toContain('emerald')
  })

  it('formats signed aggregate values', () => {
    expect(formatSignedCurrency(-10)).toBe('-$10.00')
    expect(formatSignedCurrency(10)).toBe('$10.00')
  })

  it('keeps small unit prices precise and uses scientific notation at extremes', () => {
    expect(formatUnitPrice(0.001234567)).toBe('$0.00123457')
    expect(formatUnitPrice(0.00000001234567)).toBe('$1.23457E-8')
    expect(formatUnitPrice(1_234_567_890_000)).toBe('$1.23457E12')
  })
})
