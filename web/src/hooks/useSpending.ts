import { useQuery } from 'urql'
import { SPENDING_BY_CATEGORY_QUERY } from '../graphql/queries'
import type { CategorySpendingAggregate, SpendingByCategoryReport, SpendingFilter } from '../types/graphql'
import type { CategorySpending, SpendingPeriod } from '../types/domain'

export function useSpendingByCategory(filter: SpendingFilter) {
  const [result, reexecuteQuery] = useQuery<{ spendingByCategory: SpendingByCategoryReport }, { filter: SpendingFilter }>({
    query: SPENDING_BY_CATEGORY_QUERY,
    variables: { filter },
  })

  const report = result.data?.spendingByCategory ?? null

  return {
    ...result,
    period: report ? spendingReportTotalPeriod(report) : undefined,
    periods: report ? spendingReportPeriods(report) : [],
    report,
    reexecuteQuery,
  }
}

function spendingReportTotalPeriod(report: SpendingByCategoryReport): SpendingPeriod {
  const firstPeriod = report.periods[0]
  const lastPeriod = report.periods[report.periods.length - 1]

  return {
    periodLabel: 'Total',
    periodStart: firstPeriod?.periodStart ?? '',
    periodEnd: lastPeriod?.periodEnd ?? '',
    total: report.totalAmount,
    categories: report.categories.map(aggregateCategory),
  }
}

function spendingReportPeriods(report: SpendingByCategoryReport): SpendingPeriod[] {
  return report.periods.map((period) => ({
    periodLabel: period.periodLabel,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    total: period.totalAmount,
    categories: report.categories.map((category) => categoryPeriod(category, period.periodLabel)),
  }))
}

function aggregateCategory(category: CategorySpendingAggregate): CategorySpending {
  return {
    category: category.category,
    total: category.totalAmount,
    transactionCount: category.transactionCount,
    percentOfTotal: category.percentOfTotal,
  }
}

function categoryPeriod(category: CategorySpendingAggregate, periodLabel: string): CategorySpending {
  const period = category.periods.find((item) => item.periodLabel === periodLabel)
  return {
    category: category.category,
    total: period?.totalAmount ?? 0,
    transactionCount: period?.transactionCount ?? 0,
    percentOfTotal: period?.percentOfTotal ?? 0,
  }
}
