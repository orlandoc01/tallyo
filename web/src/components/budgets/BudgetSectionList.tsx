import { useMemo } from 'react'
import type { BudgetReport, CategoryGroup } from '../../types/graphql'
import { periodFromMonthKey, toDateInputValue } from '../../utils/dates'
import { EmptyState } from '../common/EmptyState'
import { BudgetSectionRow } from './BudgetSectionRow'

// Groups without budget lines yet are appended as empty sections so every
// category group stays editable.
export function BudgetSectionList({
  report,
  categoryGroups,
  editable,
  monthKey,
  savingCategoryId,
  onSaveLine,
}: {
  report: BudgetReport
  categoryGroups: CategoryGroup[]
  editable: boolean
  monthKey: string
  savingCategoryId: string | null
  onSaveLine: (categoryId: string, amount: number) => void
}) {
  const sections = useMemo(() => {
    if (!categoryGroups.length) return report.sections
    const reportGroupIds = new Set(report.sections.map((s) => s.group.id))
    const missing = categoryGroups
      .filter((group) => !reportGroupIds.has(group.id))
      .map((group) => ({
        label: group.name,
        group,
        budgeted: 0,
        actual: 0,
        remaining: 0,
        lines: [],
      }))
    return [...report.sections, ...missing]
  }, [report, categoryGroups])

  if (sections.length === 0) {
    return <EmptyState description="Create one to start budgeting." title="No income or expense categories yet" />
  }

  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <BudgetSectionRow
          key={section.group.id}
          editable={editable}
          onSaveLine={onSaveLine}
          savingCategoryId={savingCategoryId}
          section={section}
          transactionLinkForCategory={(categoryId) => transactionsPathForBudgetCategory(monthKey, categoryId)}
        />
      ))}
    </div>
  )
}

function transactionsPathForBudgetCategory(monthKey: string, categoryId: string) {
  const period = periodFromMonthKey(monthKey)
  const params = new URLSearchParams({ category_ids: categoryId })
  if (period) {
    params.set('start_date', toDateInputValue(period.start))
    params.set('end_date', toDateInputValue(period.end))
  }
  return `/transactions?${params.toString()}`
}
