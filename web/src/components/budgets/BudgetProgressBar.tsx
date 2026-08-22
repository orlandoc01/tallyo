import type { ReactNode } from 'react'
import type { BudgetLine } from '../../types/graphql'
import { CASH_FLOW_EXPENSE_BAR_FILL, CASH_FLOW_INCOME_BAR_FILL } from '../../utils/colors'
import { chartFocusOpacityClassName, chartFocusOpacityVariables } from '../../utils/chartStyles'

export function BudgetProgressBar({ actual, budgeted, category, children }: { actual: number; budgeted: number; category: BudgetLine['category']; children: ReactNode }) {
  const ratio = budgeted > 0 ? actual / budgeted : 0
  const percent = ratio > 0 ? Math.max(3, Math.min(1, ratio) * 100) : 0
  const ariaPercent = Math.round(Math.max(0, Math.min(1, ratio)) * 100)
  const fillColor = category.kind === 'INCOME' ? CASH_FLOW_INCOME_BAR_FILL : CASH_FLOW_EXPENSE_BAR_FILL

  return (
    <div aria-label={`Budget progress for ${category.name}`} className="relative h-9 w-full overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800">
      <div
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={ariaPercent}
        className={`absolute left-0 top-0 h-full rounded-lg transition-all ${chartFocusOpacityClassName}`}
        role="progressbar"
        style={{ ...chartFocusOpacityVariables, backgroundColor: fillColor, width: `${percent}%` }}
      />
      <div className="absolute inset-y-0 left-3 right-3 z-10 flex min-w-0 items-center truncate text-sm font-medium text-neutral-700 dark:text-neutral-100">
        {children}
      </div>
    </div>
  )
}
