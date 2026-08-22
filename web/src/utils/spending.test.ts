import { describe, expect, it } from 'vitest'
import { aggregateByGroup, topCategoriesWithEverythingElse, topNWithEverythingElse } from './spending'
import type { CategorySpending } from '../types/domain'

function makeCategory(id: number, name: string, groupName: string, groupEmoji: string) {
  return { id: String(id), name, emoji: '•', groupName, groupEmoji, kind: 'EXPENSE' as const, sortOrder: id, plaidPFC2Codes: [] }
}

function makeSpending(id: number, name: string, groupName: string, groupEmoji: string, total: number): CategorySpending {
  return {
    category: makeCategory(id, name, groupName, groupEmoji),
    total,
    transactionCount: 1,
    percentOfTotal: total / 500 * 100,
  }
}

describe('aggregateByGroup', () => {
  it('aggregates categories by group name', () => {
    const items: CategorySpending[] = [
      makeSpending(1, 'Groceries', 'Food', '🍽️', 100),
      makeSpending(2, 'Dining Out', 'Food', '🍽️', 80),
      makeSpending(3, 'Rent', 'Housing', '🏠', 200),
    ]

    const result = aggregateByGroup(items)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Housing')
    expect(result[0].total).toBe(200)
    expect(result[1].name).toBe('Food')
    expect(result[1].total).toBe(180)
  })

  it('returns single-item groups unchanged', () => {
    const items: CategorySpending[] = [
      makeSpending(1, 'Groceries', 'Food', '🍽️', 100),
      makeSpending(3, 'Rent', 'Housing', '🏠', 200),
    ]

    const result = aggregateByGroup(items)
    expect(result).toHaveLength(2)
    expect(result[0].total).toBe(200)
    expect(result[1].total).toBe(100)
  })
})

describe('topNWithEverythingElse', () => {
  it('returns all items when count is within limit', () => {
    const items = aggregateByGroup([
      makeSpending(1, 'Groceries', 'Food', '🍽️', 100),
      makeSpending(3, 'Rent', 'Housing', '🏠', 200),
    ])

    const result = topNWithEverythingElse(items, 5)
    expect(result.visible).toHaveLength(2)
    expect(result.everythingElse).toBeNull()
  })

  it('groups excess items into Everything else', () => {
    const spendings: CategorySpending[] = Array.from({ length: 8 }, (_, i) =>
      makeSpending(i + 1, `Cat ${i + 1}`, `Group ${i + 1}`, '•', 100 - i * 10),
    )
    const items = aggregateByGroup(spendings)
    const result = topNWithEverythingElse(items, 5)

    expect(result.everythingElse).not.toBeNull()
    expect(result.everythingElse!.name).toBe('Everything else')
    expect(result.visible).toContain(result.everythingElse)
  })
})

describe('topCategoriesWithEverythingElse', () => {
  it('returns all categories when within limit', () => {
    const items: CategorySpending[] = [
      makeSpending(1, 'Groceries', 'Food', '🍽️', 100),
      makeSpending(2, 'Rent', 'Housing', '🏠', 200),
    ]

    const result = topCategoriesWithEverythingElse(items, 10)
    expect(result.visible).toHaveLength(2)
    expect(result.everythingElse).toBeNull()
  })

  it('creates Everything else for overflow categories', () => {
    const items: CategorySpending[] = Array.from({ length: 15 }, (_, i) =>
      makeSpending(i + 1, `Cat ${i + 1}`, `Group ${i + 1}`, '•', 100 - i * 5),
    )

    const result = topCategoriesWithEverythingElse(items, 10)
    expect(result.everythingElse).not.toBeNull()
    expect(result.everythingElse!.category.name).toBe('Everything else')
    const visibleNames = result.visible.map((v) => v.category.name)
    expect(visibleNames).toContain('Everything else')
  })

  it('includes negative categories alongside top positive ones', () => {
    const items: CategorySpending[] = [
      makeSpending(1, 'Income', 'Income', '💵', -500),
      makeSpending(2, 'Groceries', 'Food', '🍽️', 100),
      makeSpending(3, 'Rent', 'Housing', '🏠', 200),
    ]

    const result = topCategoriesWithEverythingElse(items, 10)
    const names = result.visible.map((v) => v.category.name)
    expect(names).toContain('Income')
    expect(names).toContain('Groceries')
    expect(names).toContain('Rent')
  })
})
