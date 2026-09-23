import { describe, expect, it } from 'vitest'
import { budgetBarPercent, budgetPercent, budgetTone, formatBudgetDelta } from './budgetMath'

describe('budgetTone', () => {
  it('flags expenses over plan as negative and at or under plan as positive', () => {
    expect(budgetTone(120, 100, false)).toBe('negative')
    expect(budgetTone(100, 100, false)).toBe('positive')
    expect(budgetTone(80, 100, false)).toBe('positive')
    expect(budgetTone(5, 0, false)).toBe('negative')
  })

  it('inverts the rule for income', () => {
    expect(budgetTone(120, 100, true)).toBe('positive')
    expect(budgetTone(100, 100, true)).toBe('positive')
    expect(budgetTone(80, 100, true)).toBe('negative')
    expect(budgetTone(5, 0, true)).toBe('positive')
  })
})

describe('budgetPercent', () => {
  it('rounds the ratio and reports null without a plan', () => {
    expect(budgetPercent(219.29, 61.63)).toBe(356)
    expect(budgetPercent(0, 319)).toBe(0)
    expect(budgetPercent(10, 0)).toBeNull()
  })

  it('keeps the sign-preserving ratio for a negative plan', () => {
    expect(budgetPercent(-200, -500)).toBe(40)
    expect(budgetPercent(250, -500)).toBe(-50)
    expect(budgetBarPercent(-200, -500)).toBe(40)
    expect(budgetBarPercent(250, -500)).toBe(0)
  })

  it('clamps the bar width to 0..100', () => {
    expect(budgetBarPercent(219.29, 61.63)).toBe(100)
    expect(budgetBarPercent(73.15, 108.81)).toBe(67)
    expect(budgetBarPercent(-20, 100)).toBe(0)
    expect(budgetBarPercent(10, 0)).toBe(0)
  })
})

describe('formatBudgetDelta', () => {
  it('signs non-zero deltas', () => {
    expect(formatBudgetDelta(157.66)).toBe('+$157.66')
    expect(formatBudgetDelta(-35.66)).toBe('-$35.66')
    expect(formatBudgetDelta(0)).toBe('$0.00')
  })
})
