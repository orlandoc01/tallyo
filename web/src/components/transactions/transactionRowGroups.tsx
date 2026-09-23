import type { TransactionSort } from '../../types/graphql'
import { SORT_OPTIONS, sortFromId, sortId } from './transactionFilterPresets'

export function TransactionSortSelect({
  ariaLabel,
  onSortChange,
  sort,
}: {
  ariaLabel?: string
  onSortChange: (sort: TransactionSort) => void
  sort?: TransactionSort
}) {
  return (
    <select
      aria-label={ariaLabel}
      className="h-8 rounded-md border border-border-strong bg-surface px-2 text-[13px] text-text-1 outline-none focus:border-brand-600 dark:bg-bg"
      onChange={(event) => onSortChange(sortFromId(event.target.value))}
      value={sort ? sortId(sort) : SORT_OPTIONS[0].id}
    >
      {SORT_OPTIONS.map((option) => (
        <option key={option.id} value={option.id}>{option.label}</option>
      ))}
    </select>
  )
}
