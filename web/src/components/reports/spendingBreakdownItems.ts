import type { CategorySpending } from '../../types/domain'
import { spendingChartColor } from '../../utils/chartStyles'
import { type GroupBy, aggregateByGroup, topCategoriesWithEverythingElse, topNWithEverythingElse } from '../../utils/spending'

const EVERYTHING_ELSE_ID = 'everything-else'
const PIE_FOLD_THRESHOLD_PCT = 1.5

export interface BreakdownItem {
  categoryIds: string[]
  id: string
  name: string
  emoji: string
  total: number
  transactionCount: number
  percentOfTotal: number
  color: string
}

export function maxVisibleFor(groupBy?: GroupBy) {
  return groupBy === 'group' ? 6 : 10
}

export function nonZeroSorted(categories: CategorySpending[]) {
  return [...categories].filter((item) => item.total !== 0).sort((a, b) => b.total - a.total)
}

export function breakdownItemCount(categories: CategorySpending[], groupBy?: GroupBy) {
  return groupBy === 'group' ? aggregateByGroup(categories).length : categories.filter((c) => c.total > 0).length
}

export function breakdownItems(categories: CategorySpending[], groupBy: GroupBy | undefined, expanded: boolean): BreakdownItem[] {
  const maxVisible = maxVisibleFor(groupBy)
  if (groupBy === 'group') {
    const grouped = aggregateByGroup(categories)
    const { visible, everythingElse } = expanded ? { visible: grouped, everythingElse: null } : topNWithEverythingElse(grouped, maxVisible)
    const visibleGroupIds = new Set(visible.map((item) => item.id))
    const categoryIdsByGroup = new Map<string, string[]>()
    for (const category of categories) {
      const ids = categoryIdsByGroup.get(category.category.groupName) ?? []
      ids.push(category.category.id)
      categoryIdsByGroup.set(category.category.groupName, ids)
    }
    const everythingElseCategoryIds = grouped.filter((item) => !visibleGroupIds.has(item.id)).flatMap((item) => categoryIdsByGroup.get(item.id) ?? [])
    return visible.map((item) => ({
      categoryIds: item === everythingElse ? everythingElseCategoryIds : categoryIdsByGroup.get(item.id) ?? [],
      id: item.id,
      name: item.name,
      emoji: item.emoji,
      total: item.total,
      transactionCount: item.transactionCount,
      percentOfTotal: item.percentOfTotal,
      color: spendingChartColor(item.id),
    }))
  }

  const { visible, everythingElse } = expanded ? { visible: categories, everythingElse: null as CategorySpending | null } : topCategoriesWithEverythingElse(categories, maxVisible)
  const visibleCategoryIds = new Set(visible.map((item) => item.category.id))
  const everythingElseCategoryIds = categories.filter((item) => !visibleCategoryIds.has(item.category.id)).map((item) => item.category.id)
  return visible.map((item) => ({
    categoryIds: item === everythingElse ? everythingElseCategoryIds : [item.category.id],
    id: item.category.id,
    name: item.category.name,
    emoji: item.category.emoji,
    total: item.total,
    transactionCount: item.transactionCount,
    percentOfTotal: item.percentOfTotal,
    color: spendingChartColor(item.category.id),
  }))
}

export function pieItems(items: BreakdownItem[], expanded: boolean): BreakdownItem[] {
  const positiveTotal = items.reduce((total, item) => total + Math.max(0, item.total), 0)
  const visible = items.filter((item) => positiveTotal === 0 || (expanded ? item.total > 0 : (Math.max(0, item.total) / positiveTotal) * 100 >= PIE_FOLD_THRESHOLD_PCT))
  const hidden = items.filter((item) => item.total > 0 && !visible.includes(item))
  const hiddenTotal = hidden.reduce((total, item) => total + item.total, 0)
  const hiddenCount = hidden.reduce((total, item) => total + item.transactionCount, 0)
  const hiddenCategoryIds = hidden.flatMap((item) => item.categoryIds)
  const existing = visible.find((item) => item.id === EVERYTHING_ELSE_ID)
  const percent = (total: number) => (positiveTotal > 0 ? (total / positiveTotal) * 100 : 0)

  const visibleItems = visible.map((item) => item === existing
    ? { ...item, categoryIds: [...item.categoryIds, ...hiddenCategoryIds], total: item.total + hiddenTotal, transactionCount: item.transactionCount + hiddenCount, percentOfTotal: percent(item.total + hiddenTotal) }
    : { ...item, percentOfTotal: percent(Math.max(0, item.total)) })

  if (hiddenTotal === 0 || existing) return visibleItems
  return [...visibleItems, {
    categoryIds: hiddenCategoryIds,
    id: EVERYTHING_ELSE_ID,
    name: 'Everything else',
    emoji: '•',
    total: hiddenTotal,
    transactionCount: hiddenCount,
    percentOfTotal: percent(hiddenTotal),
    color: spendingChartColor(EVERYTHING_ELSE_ID),
  }]
}
