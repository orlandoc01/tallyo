import { useMutation, useQuery } from 'urql'
import { BUDGET_REPORT_HISTORY_QUERY, BUDGET_REPORT_HISTORY_WITH_SECTIONS_QUERY, BUDGET_REPORT_QUERY } from '../graphql/queries'
import { COPY_BUDGETS_MUTATION, DELETE_BUDGET_MUTATION, SET_BUDGET_MUTATION } from '../graphql/mutations'
import type {
  BudgetReport,
  BudgetReportHistory,
  BudgetReportHistoryInput,
  BudgetReportInput,
  CopyBudgetsInput,
  CopyBudgetsPayload,
  DeleteBudgetInput,
  DeleteBudgetPayload,
  SetBudgetInput,
  SetBudgetPayload,
} from '../types/graphql'

export function useBudgetReport(input: BudgetReportInput, pause = false) {
  const [result, reexecuteQuery] = useQuery<{ budgetReport: BudgetReport }, { input: BudgetReportInput }>({
    query: BUDGET_REPORT_QUERY,
    variables: { input },
    pause,
  })
  return {
    ...result,
    report: result.data?.budgetReport ?? null,
    reexecuteQuery,
  }
}

export function useBudgetReportHistory(input: BudgetReportHistoryInput | null = null, includeSections = false, pause = false) {
  const [result, reexecuteQuery] = useQuery<{ budgetReportHistory: BudgetReportHistory }, { input: BudgetReportHistoryInput | null }>({
    query: includeSections ? BUDGET_REPORT_HISTORY_WITH_SECTIONS_QUERY : BUDGET_REPORT_HISTORY_QUERY,
    variables: { input },
    pause,
  })
  return {
    ...result,
    history: result.data?.budgetReportHistory ?? null,
    reexecuteQuery,
  }
}

export function useBudgetMutations() {
  const [setBudgetState, runSetBudget] = useMutation<{ setBudget: SetBudgetPayload }, { input: SetBudgetInput }>(SET_BUDGET_MUTATION)
  const [deleteBudgetState, runDeleteBudget] = useMutation<{ deleteBudget: DeleteBudgetPayload }, { input: DeleteBudgetInput }>(DELETE_BUDGET_MUTATION)
  const [copyBudgetsState, runCopyBudgets] = useMutation<{ copyBudgets: CopyBudgetsPayload }, { input: CopyBudgetsInput }>(COPY_BUDGETS_MUTATION)

  return {
    setBudget: runSetBudget,
    deleteBudget: runDeleteBudget,
    copyBudgets: runCopyBudgets,
    setBudgetState,
    deleteBudgetState,
    copyBudgetsState,
  }
}
