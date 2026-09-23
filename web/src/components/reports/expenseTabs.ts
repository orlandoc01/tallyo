import type { SpendingFilterTab } from '../../hooks/useSpendingFilterParams'

export const EXPENSE_TABS: ReadonlyArray<{ value: SpendingFilterTab; label: string }> = [
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'trends', label: 'Trends' },
  { value: 'comparison', label: 'Comparison' },
]
