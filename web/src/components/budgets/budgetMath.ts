import { formatCurrency } from '../../utils/currency'

export type BudgetTone = 'positive' | 'negative'

export const BUDGET_BAR_COLOR = {
  INCOME: '#2f9e6b',
  EXPENSE: '#d94a4a',
  NET: 'rgb(var(--brand-600))',
} as const

export const budgetToneClass: Record<BudgetTone, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
}

export function budgetTone(actual: number, planned: number, isIncome: boolean): BudgetTone {
  const unfavorable = isIncome ? actual < planned : actual > planned
  return unfavorable ? 'negative' : 'positive'
}

// A negative plan (a Net deficit) is still a plan; only 0 means "no plan".
export function budgetPercent(actual: number, planned: number): number | null {
  return planned === 0 ? null : Math.round((actual / planned) * 100)
}

export function budgetBarPercent(actual: number, planned: number) {
  return Math.min(100, Math.max(0, budgetPercent(actual, planned) ?? 0))
}

export function formatBudgetDelta(delta: number) {
  if (delta === 0) return formatCurrency(0)
  return `${delta > 0 ? '+' : '-'}${formatCurrency(delta)}`
}
