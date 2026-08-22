import type { Budget, BudgetReport, BudgetReportHistory } from '../../types/graphql'
import { BUDGET_REPORT_HISTORY_QUERY, BUDGET_REPORT_QUERY } from '../queries'
import { forEachCachedQuery, invalidateRoot, invalidateRoots, type InvalidatingCache, type MutationUpdaters, type QueryCache } from './shared'

type BudgetReportQueryData = {
  budgetReport: BudgetReport
}

type BudgetReportHistoryQueryData = {
  budgetReportHistory: BudgetReportHistory
}

function budgetReportInput(field: { arguments?: Record<string, unknown> | null }) {
  return field.arguments as { input?: { month?: string } } | null | undefined
}

function isIncomeBudget(budget: Budget) {
  return budget.category.kind === 'INCOME'
}

function budgetedTotalForKind(report: Pick<BudgetReport, 'expensesBudgeted' | 'incomeBudgeted'>, budget: Budget) {
  return isIncomeBudget(budget) ? report.incomeBudgeted : report.expensesBudgeted
}

function applyBudgetTotalsByKind<T extends {
  expensesBudgeted: number
  incomeBudgeted: number
  remainingBudgeted: number
}>(item: T, budget: Budget, delta: number): T {
  if (delta === 0) return item
  return isIncomeBudget(budget)
    ? { ...item, incomeBudgeted: item.incomeBudgeted + delta, remainingBudgeted: item.remainingBudgeted + delta }
    : { ...item, expensesBudgeted: item.expensesBudgeted + delta, remainingBudgeted: item.remainingBudgeted - delta }
}

function updateBudgetHistoryTotals(data: BudgetReportHistoryQueryData | null, month: string, budget: Budget, budgetDelta: number) {
  if (!data?.budgetReportHistory?.items) return data
  return {
    ...data,
    budgetReportHistory: {
      ...data.budgetReportHistory,
      items: data.budgetReportHistory.items.map((item) => {
        if (item.month !== month) return item
        return applyBudgetTotalsByKind(item, budget, budgetDelta)
      }),
    },
  }
}

function applyBudgetLineAmount(report: BudgetReport, budget: Budget) {
  let budgetDelta = 0
  const sections = report.sections.map((section) => {
    let sectionDelta = 0
    const lines = section.lines.map((line) => {
      if (line.category.id !== budget.category.id) return line
      const delta = budget.amount - line.budgeted
      budgetDelta += delta
      sectionDelta += delta
      return { ...line, id: budget.id, budgeted: budget.amount, remaining: budget.amount - line.actual }
    })
    return sectionDelta === 0 ? section : { ...section, lines, budgeted: section.budgeted + sectionDelta, remaining: section.remaining + sectionDelta }
  })
  return budgetDelta === 0 ? report : { ...report, ...applyBudgetTotalsByKind(report, budget, budgetDelta), sections }
}

export function updateCachedBudgetReports(cache: QueryCache, budget: Budget) {
  let historyDelta = 0
  forEachCachedQuery<BudgetReportQueryData>(cache, 'budgetReport', BUDGET_REPORT_QUERY, (data, input) => {
    if (!data?.budgetReport || (input as { month?: string } | null)?.month !== budget.month) return data
    const nextReport = applyBudgetLineAmount(data.budgetReport, budget)
    historyDelta += budgetedTotalForKind(nextReport, budget) - budgetedTotalForKind(data.budgetReport, budget)
    return nextReport === data.budgetReport ? data : { ...data, budgetReport: nextReport }
  })
  if (historyDelta !== 0) {
    cache.updateQuery<BudgetReportHistoryQueryData>({ query: BUDGET_REPORT_HISTORY_QUERY, variables: { input: null } }, (data) => updateBudgetHistoryTotals(data, budget.month, budget, historyDelta))
  }
}

function removeBudgetLine(report: BudgetReport, budgetID: string) {
  let budgetDelta = 0
  let deletedBudget: Budget | null = null
  const sections = report.sections.map((section) => {
    let sectionDelta = 0
    const lines = section.lines.map((line) => {
      if (line.id !== budgetID) return line
      const delta = -line.budgeted
      budgetDelta += delta
      sectionDelta += delta
      deletedBudget = { id: budgetID, month: report.month, amount: line.budgeted, category: line.category }
      return { ...line, id: null, budgeted: 0, remaining: -line.actual }
    })
    return sectionDelta === 0 ? section : { ...section, lines, budgeted: section.budgeted + sectionDelta, remaining: section.remaining + sectionDelta }
  })
  return budgetDelta === 0 || !deletedBudget
    ? { report, budgetDelta: 0, deletedBudget: null }
    : { report: { ...report, ...applyBudgetTotalsByKind(report, deletedBudget, budgetDelta), sections }, budgetDelta, deletedBudget }
}

export function removeBudgetFromCachedReports(cache: QueryCache, budgetID: string) {
  forEachCachedQuery<BudgetReportQueryData>(cache, 'budgetReport', BUDGET_REPORT_QUERY, (data, input) => {
    const month = (input as { month?: string } | null)?.month
    if (!data?.budgetReport || !month) return data
    const { report, budgetDelta, deletedBudget } = removeBudgetLine(data.budgetReport, budgetID)
    if (deletedBudget) {
      cache.updateQuery<BudgetReportHistoryQueryData>({ query: BUDGET_REPORT_HISTORY_QUERY, variables: { input: null } }, (history) => updateBudgetHistoryTotals(history, month, deletedBudget, budgetDelta))
    }
    return report === data.budgetReport ? data : { ...data, budgetReport: report }
  })
}

function invalidateBudgetMonth(cache: InvalidatingCache, month: string) {
  for (const field of cache.inspectFields('Query')) {
    if (field.fieldName !== 'budgetReport') continue
    const input = budgetReportInput(field)?.input
    if (input?.month === month) cache.invalidate('Query', 'budgetReport', field.arguments ?? null)
  }
}

export const budgetMutationUpdaters = {
  setBudget(result, _args, cache) {
    const budget = (result as { setBudget?: { budget?: Budget } }).setBudget?.budget
    if (budget) {
      updateCachedBudgetReports(cache, budget)
    } else {
      invalidateRoots(cache, 'budgetReport', 'budgetReportHistory')
    }
  },
  deleteBudget(_result, args, cache) {
    const budgetID = (args.input as { id?: string } | undefined)?.id
    if (budgetID) {
      removeBudgetFromCachedReports(cache, budgetID)
    } else {
      invalidateRoots(cache, 'budgetReport', 'budgetReportHistory')
    }
  },
  copyBudgets(_result, args, cache) {
    const toMonth = (args.input as { toMonth?: string } | undefined)?.toMonth
    if (toMonth) {
      invalidateBudgetMonth(cache, toMonth)
    } else {
      invalidateRoot(cache, 'budgetReport')
    }
    invalidateRoot(cache, 'budgetReportHistory')
  },
} satisfies MutationUpdaters
