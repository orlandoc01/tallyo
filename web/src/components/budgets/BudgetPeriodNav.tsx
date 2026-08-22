import { ChevronLeft, ChevronRight } from 'lucide-react'

export function BudgetPeriodNav({
  label,
  unit,
  onShift,
}: {
  label: string
  unit: 'month' | 'year'
  onShift: (direction: -1 | 1) => void
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white px-3 py-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <button
        aria-label={`Previous ${unit}`}
        className="rounded-xl p-2 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-800"
        onClick={() => onShift(-1)}
        type="button"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{label}</span>
      <button
        aria-label={`Next ${unit}`}
        className="rounded-xl p-2 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-800"
        onClick={() => onShift(1)}
        type="button"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  )
}
