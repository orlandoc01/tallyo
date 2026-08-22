import { useState, type FormEvent } from 'react'
import clsx from 'clsx'
import { Link } from 'react-router'
import type { BudgetLine } from '../../types/graphql'
import { formatCurrency } from '../../utils/currency'
import { BudgetProgressBar } from './BudgetProgressBar'

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

  function commit(e?: FormEvent) {
    e?.preventDefault()
    const parsed = Number.parseFloat(draft)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed !== line.budgeted) {
      onSave(parsed)
    }
    setEditing(false)
  }

  const delta = line.actual - line.budgeted
  const unfavorableDelta = isIncome ? delta < 0 : delta > 0
  return (
    <div className="border-b border-neutral-100 px-4 py-3 last:border-b-0 dark:border-neutral-800">
      <div className="mb-1 flex justify-end">
        <div className="flex shrink-0 items-baseline justify-end gap-2 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
          <span>Planned:</span>
          {editing && editable ? (
            <form className="flex items-center gap-1" onSubmit={commit}>
              <span aria-hidden className="text-neutral-400">$</span>
              <input
                aria-label={`Budget amount for ${line.category.name}`}
                autoFocus
                className="w-20 rounded-md border border-neutral-200 bg-white px-2 py-1 text-right text-sm normal-case tracking-normal tabular-nums focus:border-brand-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                disabled={saving}
                inputMode="decimal"
                onBlur={() => commit()}
                onChange={(e) => setDraft(e.target.value)}
                value={draft}
              />
            </form>
          ) : editable ? (
            <button
              aria-label={`Edit budget for ${line.category.name}`}
              className="rounded-md px-1.5 py-0.5 text-sm font-normal normal-case tracking-normal tabular-nums text-neutral-900 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
              onClick={() => { setDraft(line.budgeted.toFixed(2)); setEditing(true) }}
              type="button"
            >
              {formatCurrency(line.budgeted)}
            </button>
          ) : (
            <span className="px-1.5 py-0.5 text-sm font-normal normal-case tracking-normal tabular-nums text-neutral-900 dark:text-neutral-100">
              {formatCurrency(line.budgeted)}
            </span>
          )}
        </div>
      </div>
      <Link
        aria-label={`View ${line.category.name} transactions for this month`}
        className="group block rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-400"
        to={transactionLinkTo}
      >
        <BudgetProgressBar actual={line.actual} budgeted={line.budgeted} category={line.category}>
          <span aria-hidden className="mr-1.5">{line.category.emoji}</span>
          <span className="truncate">{line.category.name}</span>
        </BudgetProgressBar>
      </Link>
      <div className="mt-1 flex justify-between gap-3 text-xs text-neutral-500">
        <span>{line.budgeted > 0 ? `${Math.round((line.actual / line.budgeted) * 100)}%` : 'No budget'}</span>
        <span className={clsx('tabular-nums', unfavorableDelta ? 'text-rose-600' : 'text-emerald-600')}>
          <span className="font-semibold uppercase tracking-wide">Actual:</span> {formatCurrency(line.actual)} ({formatBudgetDelta(delta)})
        </span>
      </div>
    </div>
  )
}

function formatBudgetDelta(delta: number) {
  if (delta === 0) return formatCurrency(0)
  return `${delta > 0 ? '+' : '-'}${formatCurrency(delta)}`
}
