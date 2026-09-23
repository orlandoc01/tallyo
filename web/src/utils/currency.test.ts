import { describe, expect, it } from 'vitest'
import { formatCurrencyAbbrev, formatSignedCurrency, formatTransactionAmount, formatUnitPrice, maskAmount, transactionAmountClassName } from './currency'

describe('currency formatting', () => {
  it('formats spending amounts normally', () => {
    expect(formatTransactionAmount(123.45)).toBe('$123.45')
    expect(transactionAmountClassName(123.45)).toBe('text-text-2')
  })

  it('formats negative Plaid amounts as green credits', () => {
    expect(formatTransactionAmount(-52.12)).toBe('+$52.12')
    expect(transactionAmountClassName(-52.12)).toBe('text-positive')
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

  it('abbreviates sidebar and donut totals with two decimals', () => {
    expect(formatCurrencyAbbrev(27_541_503.19)).toBe('$27.54M')
    expect(formatCurrencyAbbrev(19_740_000)).toBe('$19.74M')
    expect(formatCurrencyAbbrev(-21_803.48)).toBe('-$21.80K')
    expect(formatCurrencyAbbrev(147.37)).toBe('$147.37')
    expect(formatCurrencyAbbrev(0)).toBe('$0.00')
    expect(formatCurrencyAbbrev(23_000, 1)).toBe('$23.0K')
    expect(formatCurrencyAbbrev(27_541_503, 1)).toBe('$27.5M')
  })

  it('masks digit runs for privacy mode', () => {
    expect(maskAmount('$27,452,131.00')).toBe('$••,•••,•••.••')
    expect(maskAmount('$27.5M')).toBe('$••.•M')
    expect(maskAmount('-$1,234,567,890.12')).toBe('-$•,•••,•••,•••.••')
    expect(maskAmount('+12.3%')).toBe('+••.•%')
    expect(maskAmount('$1234567.89')).toBe('$••••••.••')
    expect(maskAmount(formatUnitPrice(0.00000001234567))).toBe('$•.•••••E-•')
  })
})
