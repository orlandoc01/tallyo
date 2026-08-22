import { useMemo } from 'react'
import type { BudgetReport, CategoryGroup } from '../../types/graphql'
import { periodFromMonthKey, toDateInputValue } from '../../utils/dates'
import { BudgetSectionRow } from './BudgetSectionRow'

// Monthly budget sections. Groups without budget lines yet are appended as
// empty sections so every category group stays editable.
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
    return (
      <p className="rounded-2xl border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-500">
        No income or expense categories yet. Create one to start budgeting.
      </p>
    )
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
