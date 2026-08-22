import { formatCurrency } from '../../utils/currency'
import { CASH_FLOW_EXPENSE_BAR_FILL, CASH_FLOW_INCOME_BAR_FILL } from '../../utils/colors'
import { chartOpacityForFocus } from '../../utils/chartStyles'

export function BudgetTotals({
  report,
}: {
  report: {
    expensesBudgeted: number
    expensesActual: number
    incomeBudgeted: number
    incomeActual: number
    remainingBudgeted: number
    remainingActual: number
  }
}) {
  const totals = [
    { label: 'Income', planned: report.incomeBudgeted, actual: report.incomeActual, color: 'emerald' },
    { label: 'Expenses', planned: report.expensesBudgeted, actual: report.expensesActual, color: 'rose' },
    { label: 'Net', planned: report.remainingBudgeted, actual: report.remainingActual, color: 'emerald' },
  ] as const

  return (
    <div className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      {totals.map((total) => (
        <BudgetTotalProgress key={total.label} {...total} />
      ))}
    </div>
  )
}

function BudgetTotalProgress({
  label,
  planned,
  actual,
  color,
}: {
  label: string
  planned: number
  actual: number
  color: 'emerald' | 'rose'
}) {
  const ratio = planned > 0 ? actual / planned : 0
  const percent = Math.max(0, Math.min(1, ratio)) * 100
  const percentLabel = planned > 0 ? `${Math.round(ratio * 100)}%` : 'No plan'
  const barFill = color === 'rose' ? CASH_FLOW_EXPENSE_BAR_FILL : CASH_FLOW_INCOME_BAR_FILL
  const textClass = color === 'rose' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'

  return (
    <div aria-label={`${label} budget summary`}>
      <div className="mb-1 flex items-end justify-between gap-3">
        <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{label}</div>
        <div className="flex items-baseline justify-end gap-2 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
          <div>Planned</div>
          <div className={`text-sm normal-case tracking-normal tabular-nums ${textClass}`}>{formatCurrency(planned)}</div>
        </div>
      </div>
      <div aria-label={`${label} progress`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.round(percent)} className="h-3 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800" role="progressbar">
        <div className="h-full rounded-full transition-all" style={{ backgroundColor: barFill, opacity: chartOpacityForFocus(false), width: `${percent}%` }} />
      </div>
      <div className="mt-1 flex items-start justify-between gap-3 text-sm">
        <span className="font-semibold tabular-nums text-neutral-600 dark:text-neutral-300">{percentLabel}</span>
        <div className="flex items-baseline justify-end gap-2 text-right">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Actual</div>
          <div className={`font-semibold tabular-nums ${textClass}`}>{formatCurrency(actual)}</div>
        </div>
      </div>
    </div>
  )
}
