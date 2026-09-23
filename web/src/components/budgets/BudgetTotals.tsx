import clsx from 'clsx'
import { formatCurrency, formatSignedCurrency } from '../../utils/currency'
import { DottedBar } from '../common/DottedBar'
import { Card } from '../common/FormControls'
import { BUDGET_BAR_COLOR, budgetBarPercent, budgetPercent } from './budgetMath'

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
    { label: 'Income', planned: report.incomeBudgeted, actual: report.incomeActual, color: BUDGET_BAR_COLOR.INCOME, textClass: 'text-positive', format: formatCurrency },
    { label: 'Expenses', planned: report.expensesBudgeted, actual: report.expensesActual, color: BUDGET_BAR_COLOR.EXPENSE, textClass: 'text-negative', format: formatCurrency },
    { label: 'Net', planned: report.remainingBudgeted, actual: report.remainingActual, color: BUDGET_BAR_COLOR.NET, textClass: 'text-accent', format: formatSignedCurrency },
  ]

  return (
    <Card className="px-4 py-3.5 lg:px-5 lg:py-4">
      <div className="grid gap-3.5 lg:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] lg:gap-x-8 lg:gap-y-4">
        {totals.map((total) => (
          <BudgetTotalBlock key={total.label} {...total} />
        ))}
      </div>
    </Card>
  )
}

function BudgetTotalBlock({ actual, color, format, label, planned, textClass }: {
  actual: number
  color: string
  format: (amount: number) => string
  label: string
  planned: number
  textClass: string
}) {
  const percent = budgetPercent(actual, planned)
  const barPercent = budgetBarPercent(actual, planned)

  return (
    <div aria-label={`${label} budget summary`} className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 text-xs text-text-muted">
        <span>{label}</span>
        <span className="tabular-nums">{percent === null ? 'No plan' : `${percent}% of plan`}</span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-3">
        <span className={clsx('truncate text-[17px] font-semibold leading-[22px] tracking-[-0.3px] tabular-nums lg:text-lg lg:leading-6', textClass)}>{format(actual)}</span>
        <span className="shrink-0 text-xs tabular-nums text-text-muted">/ <span>{format(planned)}</span></span>
      </div>
      <div aria-label={`${label} progress`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={barPercent} className="mt-2" role="progressbar">
        <DottedBar color={color} percent={barPercent} />
      </div>
    </div>
  )
}
