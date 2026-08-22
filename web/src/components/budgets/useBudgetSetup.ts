import { useEffect, useState } from 'react'
import { useBudgetMutations } from '../../hooks/useBudgets'
import type { BudgetReport, Category } from '../../types/graphql'

export function actualsByCategory(report: BudgetReport | null) {
  const actuals = new Map<string, number>()
  for (const section of report?.sections ?? []) {
    for (const line of section.lines) {
      actuals.set(line.category.id, line.actual)
    }
  }
  return actuals
}

// Draft state for the budget setup wizard: per-category amount drafts prefilled
// from last month's actuals, the set of included categories, and the save-all
// action. `active` gates initialization so drafts are (re)built once per month
// when the wizard opens.
export function useBudgetSetup({
  active,
  monthKey,
  categories,
  previousActuals,
}: {
  active: boolean
  monthKey: string
  categories: Category[]
  previousActuals: Map<string, number>
}) {
  const { setBudget, setBudgetState } = useBudgetMutations()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [included, setIncluded] = useState<Set<string>>(() => new Set())
  const [initializedFor, setInitializedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!active || initializedFor === monthKey || categories.length === 0) return
    const nextDrafts: Record<string, string> = {}
    const nextIncluded = new Set<string>()
    let hasPrefill = false
    for (const category of categories) {
      const prefill = previousActuals.get(category.id) ?? 0
      nextDrafts[category.id] = prefill > 0 ? prefill.toFixed(2) : '0.00'
      if (prefill > 0) {
        nextIncluded.add(category.id)
        hasPrefill = true
      }
    }
    if (!hasPrefill) {
      for (const category of categories) nextIncluded.add(category.id)
    }
    setDrafts(nextDrafts)
    setIncluded(nextIncluded)
    setInitializedFor(monthKey)
  }, [active, categories, initializedFor, monthKey, previousActuals])

  function addCategory(categoryId: string) {
    setIncluded((current) => new Set(current).add(categoryId))
  }

  function removeCategory(categoryId: string) {
    setIncluded((current) => {
      const next = new Set(current)
      next.delete(categoryId)
      return next
    })
  }

  function changeAmount(categoryId: string, value: string) {
    setDrafts((current) => ({ ...current, [categoryId]: value }))
  }

  // Saves every included draft; returns an error message, or null on success.
  async function saveAll(): Promise<string | null> {
    const entries = [...included].map((categoryId) => ({
      categoryId,
      amount: Number.parseFloat(drafts[categoryId] ?? '0'),
    }))
    const invalid = entries.find((entry) => !Number.isFinite(entry.amount) || entry.amount < 0)
    if (invalid) {
      return 'Budget amounts must be non-negative numbers.'
    }
    const results = await Promise.all(entries.map((entry) => (
      setBudget({ input: { month: monthKey, categoryId: entry.categoryId, amount: entry.amount } })
    )))
    const failed = results.find((result) => result.error)
    return failed?.error ? failed.error.message : null
  }

  return { drafts, included, addCategory, removeCategory, changeAmount, saveAll, saving: setBudgetState.fetching }
}
