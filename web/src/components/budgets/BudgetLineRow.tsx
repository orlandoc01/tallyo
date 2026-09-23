import { useState, type FormEvent } from 'react'
import clsx from 'clsx'
import { Link } from 'react-router'
import type { BudgetLine } from '../../types/graphql'
import { formatCurrency } from '../../utils/currency'
import { Button } from '../common/Button'
import { DottedBar } from '../common/DottedBar'
import { TextField } from '../common/FormControls'
import { BUDGET_BAR_COLOR, budgetBarPercent, budgetPercent, budgetTone, budgetToneClass, formatBudgetDelta } from './budgetMath'

const rowClass = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 border-t border-border px-4 py-2.5 [grid-template-areas:'name_actual'_'progress_planned'] lg:h-11 lg:grid-cols-[var(--budget-line-cols)] lg:items-center lg:gap-x-3 lg:py-0 lg:[grid-template-areas:'name_progress_planned_actual']"

export function BudgetLineRow({
  editable,
  line,
  saving,
  transactionLinkTo,
  onSave,
}: {
  editable: boolean
  line: BudgetLine
  saving: boolean
  transactionLinkTo: string
  onSave: (amount: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(line.budgeted.toFixed(2))
  const isIncome = line.category.kind === 'INCOME'
  const percent = budgetPercent(line.actual, line.budgeted)
  const tone = budgetTone(line.actual, line.budgeted, isIncome)

  function commit(e?: FormEvent) {
    e?.preventDefault()
    const parsed = Number.parseFloat(draft)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed !== line.budgeted) {
      onSave(parsed)
    }
    setEditing(false)
  }

  return (
    <div className={rowClass}>
      <Link
        aria-label={`View ${line.category.name} transactions for this month`}
        className="flex min-w-0 items-center gap-2 rounded-md text-sm font-medium text-text-1 [grid-area:name] hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30"
        to={transactionLinkTo}
      >
        <span aria-hidden>{line.category.emoji}</span>
        <span className="truncate">{line.category.name}</span>
      </Link>
      <div className="flex min-w-0 items-center gap-3 [grid-area:progress]">
        <DottedBar color={isIncome ? BUDGET_BAR_COLOR.INCOME : BUDGET_BAR_COLOR.EXPENSE} percent={budgetBarPercent(line.actual, line.budgeted)} />
        <span className="shrink-0 text-[11px] tabular-nums text-text-muted lg:min-w-[60px] lg:text-right lg:text-xs">
          {percent === null ? 'No budget' : `${percent}%`}
          <span className="lg:hidden"> of</span>
        </span>
      </div>
      <div className="flex items-center justify-end text-[11px] tabular-nums text-text-muted [grid-area:planned] lg:text-sm lg:text-text-3">
        {editing && editable ? (
          <form className="w-24" onSubmit={commit}>
            <TextField
              autoFocus
              controlClassName="text-right"
              disabled={saving}
              hideLabel
              inputMode="decimal"
              label={`Budget amount for ${line.category.name}`}
              onBlur={() => commit()}
              onChange={setDraft}
              value={draft}
            />
          </form>
        ) : editable ? (
          <Button
            aria-label={`Edit budget for ${line.category.name}`}
            className="tabular-nums"
            onClick={() => { setDraft(line.budgeted.toFixed(2)); setEditing(true) }}
            size="sm"
            variant="ghost-muted"
          >
            {formatCurrency(line.budgeted)}
          </Button>
        ) : (
          <span>{formatCurrency(line.budgeted)}</span>
        )}
      </div>
      <div className={clsx('text-right text-[13px] font-medium tabular-nums [grid-area:actual] lg:text-sm', budgetToneClass[tone])}>
        {formatCurrency(line.actual)}
        <span className="hidden lg:inline"> ({formatBudgetDelta(line.actual - line.budgeted)})</span>
      </div>
    </div>
  )
}
