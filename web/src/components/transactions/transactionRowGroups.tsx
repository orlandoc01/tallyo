import type { TransactionSort } from '../../types/graphql'

const sortOptions: Array<{ label: string; value: string; sort: TransactionSort }> = [
  { label: 'Date new to old', value: 'DATE:DESC', sort: { field: 'DATE', direction: 'DESC' } },
  { label: 'Date old to new', value: 'DATE:ASC', sort: { field: 'DATE', direction: 'ASC' } },
  { label: 'Amount high to low', value: 'AMOUNT:DESC', sort: { field: 'AMOUNT', direction: 'DESC' } },
  { label: 'Amount low to high', value: 'AMOUNT:ASC', sort: { field: 'AMOUNT', direction: 'ASC' } },
]

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
      className="rounded-xl border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-500"
      onChange={(event) => {
        const option = sortOptions.find((item) => item.value === event.target.value) ?? sortOptions[0]
        onSortChange(option.sort)
      }}
      value={sort ? `${sort.field}:${sort.direction}` : sortOptions[0].value}
    >
      {sortOptions.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}
