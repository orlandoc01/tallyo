import type { TransactionsFilter } from '../../types/graphql'
import { ActiveFilterPill, ActiveFilterRow } from '../common/FilterPanel'
import { activeFilterPills, type FilterLookups } from './transactionActiveFilters'

export function TransactionActivePills({ allCount, dateValue, filter, lookups, now, onChange, onSearchChange, search = '', size = 'md', totalCount }: {
  allCount?: number
  dateValue?: string
  filter: TransactionsFilter
  lookups: FilterLookups
  now: Date
  onChange: (filter: TransactionsFilter) => void
  onSearchChange?: (search: string) => void
  search?: string
  size?: 'sm' | 'md'
  totalCount?: number
}) {
  const pills = activeFilterPills(filter, lookups, now, dateValue)
  if (pills.length === 0 && !search) return null
  const count = totalCount !== undefined && allCount !== undefined ? `${totalCount} of ${allCount} transactions` : undefined

  return (
    <ActiveFilterRow count={count}>
      {search ? <ActiveFilterPill kind="Search" onRemove={() => onSearchChange?.('')} size={size} value={`“${search}”`} /> : null}
      {pills.map((pill) => (
        <ActiveFilterPill key={pill.key} kind={pill.kind} onRemove={() => onChange(pill.remove(filter))} size={size} value={pill.value} />
      ))}
    </ActiveFilterRow>
  )
}
