import type { NetWorthRange } from '../../types/graphql'

export const DEFAULT_NET_WORTH_RANGE: NetWorthRange = 'YTD'

export const NET_WORTH_RANGE_OPTIONS: ReadonlyArray<{ id: NetWorthRange; label: string; compact: string }> = [
  { id: 'ONE_MONTH', label: 'Past month', compact: '1M' },
  { id: 'THREE_MONTH', label: 'Three months', compact: '3M' },
  { id: 'YTD', label: 'Year to date', compact: 'YTD' },
  { id: 'ONE_YEAR', label: 'Past year', compact: '1Y' },
  { id: 'ALL', label: 'All time', compact: 'All' },
]

export function rangeOption(range: NetWorthRange) {
  return NET_WORTH_RANGE_OPTIONS.find((option) => option.id === range) ?? NET_WORTH_RANGE_OPTIONS[2]
}

