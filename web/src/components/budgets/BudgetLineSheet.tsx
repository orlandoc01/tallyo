import clsx from 'clsx'
import { useState } from 'react'
import { useBudgetMutations } from '../../hooks/useBudgets'
import { useSaveAction } from '../../hooks/useSaveAction'
import type { BudgetLine } from '../../types/graphql'
import { formatCurrency } from '../../utils/currency'
import { FormError } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetDangerAction } from '../common/SheetDangerAction'
import { SheetAvatar, SheetHero } from '../common/SheetHero'
import { SheetField, SheetStaticRow } from '../common/SheetRows'
import { budgetPercent, budgetTone, budgetToneClass } from './budgetMath'

// The budget model has no rollover setting, so that row is omitted.
export function BudgetLineSheet({ line, monthLabel, onClose, onSave }: {
  line: BudgetLine
  monthLabel: string
  onClose: () => void
  onSave: (amount: number) => void
}) {
  const { deleteBudget } = useBudgetMutations()
  const { error, save, saving } = useSaveAction()
  const [draft, setDraft] = useState(line.budgeted.toFixed(2))
  const [plannedOpen, setPlannedOpen] = useState(false)
  const isIncome = line.category.kind === 'INCOME'
  const tone = budgetToneClass[budgetTone(line.actual, line.budgeted, isIncome)]
  const percent = budgetPercent(line.actual, line.budgeted)
  const parsed = Number.parseFloat(draft)
  const valid = Number.isFinite(parsed) && parsed >= 0

  function handleSave() {
    if (!valid) return
    if (parsed !== line.budgeted) onSave(parsed)
    onClose()
  }

  const budgetId = line.id
  return (
    <MobileSheet bodyClassName="pb-2" footer={<MobileFilterFooter primaryDisabled={!valid || saving} primaryLabel="Save" onPrimary={handleSave} />} hideClose labelledBy="budget-line-title" maxHeight="84%" onClose={onClose} title="Budget">
      <div aria-label={`Budget for ${line.category.name}`} role="region">
        <SheetHero
          avatar={<SheetAvatar glyph={line.category.emoji} />}
          sub={`${line.category.groupName} · ${monthLabel}`}
          title={line.category.name}
          value={formatCurrency(line.actual)}
          valueClassName={tone}
          valueSub={percent === null ? 'No budget' : `${percent}% of ${formatCurrency(line.budgeted)}`}
        />
        {error ? <FormError className="mb-3">{error}</FormError> : null}
        <SheetField changed={draft !== line.budgeted.toFixed(2)} expanded={plannedOpen} inputMode="decimal" label="Planned" onChange={setDraft} onToggle={() => setPlannedOpen((open) => !open)} placeholder="Amount per month" type="number" value={draft} />
        <SheetStaticRow label="Spent" value={formatCurrency(line.actual)} valueClassName={clsx('font-medium', tone)} />
        {budgetId ? <SheetDangerAction busy={saving} busyLabel="Removing…" label="Remove budget" onSelect={() => { void save(() => deleteBudget({ input: { id: budgetId } }), onClose) }} /> : null}
      </div>
    </MobileSheet>
  )
}
