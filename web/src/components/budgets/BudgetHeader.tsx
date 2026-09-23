import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button, IconButton } from '../common/Button'
import { SegmentedControl } from '../common/SegmentedControl'

export type BudgetView = 'MONTH' | 'YEAR'

const budgetViewOptions: Array<{ value: BudgetView; label: string }> = [
  { value: 'MONTH', label: 'Monthly' },
  { value: 'YEAR', label: 'Yearly' },
]

export function BudgetHeader({
  addDisabled,
  canWrite,
  copying,
  label,
  onAddBudget,
  onChangeView,
  onCopyMonth,
  onShift,
  showCopy,
  unit,
  view,
}: {
  addDisabled: boolean
  canWrite: boolean
  copying: boolean
  label: string
  onAddBudget: () => void
  onChangeView: (view: BudgetView) => void
  onCopyMonth: () => void
  onShift: (direction: -1 | 1) => void
  showCopy: boolean
  unit: 'month' | 'year'
  view: BudgetView
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none lg:gap-3">
        <IconButton ariaLabel={`Previous ${unit}`} onClick={() => onShift(-1)}>
          <ChevronLeft aria-hidden className="h-4 w-4" strokeWidth={2} />
        </IconButton>
        <span className="flex-1 truncate text-center text-[15px] font-semibold text-text-1 lg:min-w-[150px] lg:flex-none lg:text-base">{label}</span>
        <IconButton ariaLabel={`Next ${unit}`} onClick={() => onShift(1)}>
          <ChevronRight aria-hidden className="h-4 w-4" strokeWidth={2} />
        </IconButton>
      </div>
      <div className="flex items-center gap-2">
        <SegmentedControl ariaLabel="Budget view" options={budgetViewOptions} value={view} onChange={onChangeView} />
        <div className="hidden items-center gap-2 lg:flex">
          {showCopy ? <Button disabled={copying} onClick={onCopyMonth} variant="secondary">Copy month</Button> : null}
          {canWrite ? (
            <AddBudgetButton disabled={addDisabled} onClick={onAddBudget} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function AddBudgetButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Button disabled={disabled} onClick={onClick} title={disabled ? 'Every category already has a budget' : undefined}>
      <Plus aria-hidden className="h-4 w-4" />
      Add budget
    </Button>
  )
}
