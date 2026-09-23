import { useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import type { BudgetSection } from '../../types/graphql'
import { formatCurrency } from '../../utils/currency'
import { ClickableRow } from '../common/ClickableRow'
import { DataGridHeader } from '../common/DataGrid'
import { Card } from '../common/FormControls'
import { BudgetLineRow } from './BudgetLineRow'
import { budgetTone, budgetToneClass } from './budgetMath'

const BUDGET_LINE_GRID_COLUMNS = 'minmax(160px,1.4fr) minmax(140px,2fr) minmax(90px,120px) minmax(130px,190px)'

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
  const tone = budgetTone(section.actual, section.budgeted, section.group.kind === 'INCOME')
  const bodyId = `budget-section-${section.group.id}`

  return (
    <Card as="section">
      <ClickableRow
        ariaControls={bodyId}
        className="flex h-12 w-full items-center justify-between gap-3 px-4 text-left transition-colors duration-150 hover:bg-raised lg:h-11"
        expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={clsx('text-[10px] leading-none text-text-muted transition-transform duration-150', open && 'rotate-90')}>▶</span>
          <span aria-hidden>{section.group.emoji}</span>
          <span className="truncate text-sm font-semibold text-text-1">{section.label}</span>
        </span>
        <span className="shrink-0 text-sm font-medium tabular-nums text-text-muted">
          <span className={budgetToneClass[tone]}>{formatCurrency(section.actual)}</span> / <span>{formatCurrency(section.budgeted)}</span>
        </span>
      </ClickableRow>
      {open ? (
        section.lines.length === 0 ? (
          <p className="border-t border-border px-4 py-3 text-[13px] text-text-muted" id={bodyId}>No categories with budgets or activity yet.</p>
        ) : (
          <div id={bodyId} style={{ '--budget-line-cols': BUDGET_LINE_GRID_COLUMNS } as CSSProperties}>
            <div className="hidden lg:block">
              <DataGridHeader gridTemplateColumns="var(--budget-line-cols)" variant="list">
                <span>Category</span>
                <span>Progress</span>
                <span className="text-right">Planned</span>
                <span className="text-right">Actual</span>
              </DataGridHeader>
            </div>
            {section.lines.map((line) => (
              <BudgetLineRow
                editable={editable}
                key={line.category.id}
                line={line}
                onSave={(amount) => onSaveLine(line.category.id, amount)}
                saving={savingCategoryId === line.category.id}
                transactionLinkTo={transactionLinkForCategory(line.category.id)}
              />
            ))}
          </div>
        )
      ) : null}
    </Card>
  )
}
