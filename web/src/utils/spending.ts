import type { Category } from '../types/graphql'
import type { CategorySpending } from '../types/domain'

export type GroupBy = 'category' | 'group'

interface GroupedSpendingItem {
  id: string
  name: string
  emoji: string
  total: number
  transactionCount: number
  percentOfTotal: number
}

export function aggregateByGroup(
  categories: Array<{ category: { id: string; name: string; emoji: string; groupName: string; groupEmoji: string }; total: number; transactionCount: number; percentOfTotal: number }>,
): GroupedSpendingItem[] {
  const groupMap = new Map<string, GroupedSpendingItem>()

  for (const item of categories) {
    const key = item.category.groupName
    const existing = groupMap.get(key)
    if (existing) {
      existing.total += item.total
      existing.transactionCount += item.transactionCount
      existing.percentOfTotal += item.percentOfTotal
    } else {
      groupMap.set(key, {
        id: key,
        name: item.category.groupName,
        emoji: item.category.groupEmoji,
        total: item.total,
        transactionCount: item.transactionCount,
        percentOfTotal: item.percentOfTotal,
      })
    }
  }

  return [...groupMap.values()].sort((a, b) => b.total - a.total)
}

interface TopNResult<T> {
  visible: T[]
  everythingElse: T | null
}

/**
 * Keeps the top `maxVisible` positive-total items and folds the rest into a
 * single synthetic "everything else" entry (built by `combineHidden`). Negative
 * items always stay visible, appended after the top entries. When the positive
 * items already fit, all items are returned and `everythingElse` is null.
 */
function partitionTopN<T>(
  items: T[],
  maxVisible: number,
  total: (item: T) => number,
  combineHidden: (hidden: T[]) => T,
): TopNResult<T> {
  const positive = items.filter((item) => total(item) > 0)
  const negative = items.filter((item) => total(item) < 0)

  if (positive.length <= maxVisible) {
    const visible = positive.length > 0 || negative.length > 0 ? [...positive, ...negative] : items
    return { visible, everythingElse: null }
  }

  const everythingElse = combineHidden(positive.slice(maxVisible))
  return { visible: [...positive.slice(0, maxVisible), ...negative, everythingElse], everythingElse }
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0)
}

export function topNWithEverythingElse(items: GroupedSpendingItem[], maxVisible: number): TopNResult<GroupedSpendingItem> {
  return partitionTopN(items, maxVisible, (item) => item.total, (hidden) => ({
    id: 'everything-else',
    name: 'Everything else',
    emoji: '•',
    total: sumBy(hidden, (item) => item.total),
    transactionCount: sumBy(hidden, (item) => item.transactionCount),
    percentOfTotal: sumBy(hidden, (item) => item.percentOfTotal),
  }))
}

const EVERYTHING_ELSE_CATEGORY: Category = {
  id: 'everything-else',
  name: 'Everything else',
  emoji: '•',
  groupName: 'Everything else',
  groupEmoji: '•',
  kind: 'EXPENSE',
  sortOrder: 999,
  plaidPFC2Codes: [],
}

export function topCategoriesWithEverythingElse(categories: CategorySpending[], maxVisible: number): TopNResult<CategorySpending> {
  return partitionTopN(categories, maxVisible, (item) => item.total, (hidden) => ({
    category: EVERYTHING_ELSE_CATEGORY,
    total: sumBy(hidden, (item) => item.total),
    transactionCount: sumBy(hidden, (item) => item.transactionCount),
    percentOfTotal: sumBy(hidden, (item) => item.percentOfTotal),
  }))
}
