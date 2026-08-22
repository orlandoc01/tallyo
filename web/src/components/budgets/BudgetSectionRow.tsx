import { useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { BudgetSection } from '../../types/graphql'
import { formatCurrency } from '../../utils/currency'
import { Card } from '../common/FormControls'
import { BudgetLineRow } from './BudgetLineRow'

export function BudgetSectionRow({
  editable,
  section,
  savingCategoryId,
  transactionLinkForCategory,
  onSaveLine,
}: {
  editable: boolean
  section: BudgetSection
  savingCategoryId: string | null
  transactionLinkForCategory: (categoryId: string) => string
  onSaveLine: (categoryId: string, amount: number) => void
}) {
  const [open, setOpen] = useState(true)
  const isIncome = section.group.kind === 'INCOME'
  const overBudget = !isIncome && section.budgeted > 0 && section.actual > section.budgeted

  return (
    <Card as="section" className="dark:border-neutral-800 dark:bg-neutral-900" compact>
      <button
        aria-controls={`budget-section-${section.group.id}`}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3 text-left hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown aria-hidden className="h-4 w-4 text-neutral-400" />
          ) : (
            <ChevronRight aria-hidden className="h-4 w-4 text-neutral-400" />
          )}
          <span aria-hidden className="text-lg">{section.group.emoji}</span>
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">{section.label}</span>
        </div>
        <div className="flex items-center gap-3 text-sm tabular-nums">
          <span className={clsx(overBudget ? 'text-rose-600' : 'text-neutral-700 dark:text-neutral-300')}>
            {formatCurrency(section.actual)}
          </span>
          <span aria-hidden className="text-neutral-300">/</span>
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">{formatCurrency(section.budgeted)}</span>
        </div>
      </button>
      {open ? (
        <div id={`budget-section-${section.group.id}`}>
          {section.lines.length === 0 ? (
            <p className="px-4 py-3 text-sm text-neutral-500">No categories with budgets or activity yet.</p>
          ) : (
            section.lines.map((line) => (
              <BudgetLineRow
                editable={editable}
                key={line.category.id}
                line={line}
                onSave={(amount) => onSaveLine(line.category.id, amount)}
                saving={savingCategoryId === line.category.id}
                transactionLinkTo={transactionLinkForCategory(line.category.id)}
              />
            ))
          )}
        </div>
      ) : null}
    </Card>
  )
}
