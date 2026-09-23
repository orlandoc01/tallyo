import { describe, expect, it } from 'vitest'
import { rules } from '../../mocks/fixtures'
import { ruleChips, ruleMeta, ruleTitle } from './ruleSummary'

const rule = rules[0]

describe('ruleSummary', () => {
  it('titles a rule by merchant pattern, then original pattern, then a fallback', () => {
    expect(ruleTitle(rule)).toBe('Target')
    expect(ruleTitle({ ...rule, merchantPattern: null })).toBe('TARGET')
    expect(ruleTitle({ ...rule, merchantPattern: null, originalPattern: null })).toBe('Rule')
  })

  it('joins category, group and priority in the meta line', () => {
    expect(ruleMeta(rule)).toBe('🍏 Groceries · 🍽️ Food · Priority 10')
    expect(ruleMeta({ ...rule, category: null })).toBe('No category · Priority 10')
  })

  it('derives one chip per rule field with Any/No/None defaults', () => {
    const chips = Object.fromEntries(ruleChips(rule).map((chip) => [chip.label, chip.value]))
    expect(chips.Created).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 2026$/)
    expect(chips).toEqual({
      Merchant: 'Target',
      'Original name': 'TARGET',
      'Rename merchant': 'No',
      Amount: 'Any',
      Accounts: 'Checking (...9625)',
      Tags: 'None',
      Hide: 'No change',
      Recurring: 'No change',
      Created: chips.Created,
    })
  })

  it('formats amount ranges and boolean actions', () => {
    const chip = (partial: Partial<typeof rule>, label: string) => ruleChips({ ...rule, ...partial }).find((item) => item.label === label)?.value
    expect(chip({ amountMin: 10, amountMax: 10 }, 'Amount')).toBe('$10.00')
    expect(chip({ amountMin: 10, amountMax: 100 }, 'Amount')).toBe('$10.00 to $100.00')
    expect(chip({ amountMin: 10 }, 'Amount')).toBe('At least $10.00')
    expect(chip({ amountMax: 100 }, 'Amount')).toBe('Up to $100.00')
    expect(chip({ shouldHide: true, shouldBeRecurring: false }, 'Hide')).toBe('Yes')
    expect(chip({ shouldHide: true, shouldBeRecurring: false }, 'Recurring')).toBe('No')
    expect(chip({ tags: [{ __typename: 'Tag', id: 't', name: 'Work', color: '#000', transactionCount: 0 }] }, 'Tags')).toBe('#Work')
  })
})
