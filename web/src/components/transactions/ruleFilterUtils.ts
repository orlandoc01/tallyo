export interface RuleFilterValues {
  merchantPattern: string
  originalPattern: string
  accountIds: string[]
  amountMin: string
  amountMax: string
}

export function countActiveRuleFilters(filters: RuleFilterValues) {
  return (filters.merchantPattern.trim() ? 1 : 0)
    + (filters.originalPattern.trim() ? 1 : 0)
    + filters.accountIds.length
    + (filters.amountMin.trim() ? 1 : 0)
    + (filters.amountMax.trim() ? 1 : 0)
}
