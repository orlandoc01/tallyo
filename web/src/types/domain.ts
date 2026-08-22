// Frontend-owned domain types that have no GraphQL schema counterpart.
// Schema-derived types live in the generated ./graphql module.
import type { Category } from './graphql'

/** Aggregated spend for a single category within a period (frontend-computed). */
export interface CategorySpending {
  category: Category
  total: number
  transactionCount: number
  percentOfTotal: number
}

/** A spending period with its per-category breakdown (frontend-computed). */
export interface SpendingPeriod {
  periodLabel: string
  periodStart: string
  periodEnd: string
  categories: CategorySpending[]
  total: number
}
