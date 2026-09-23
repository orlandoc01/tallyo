import type { TransactionSort } from '../../types/graphql'
import { SORT_OPTIONS, sortId, type SortId } from '../transactions/transactionFilterPresets'

export const SORT_LABELS: Record<SortId, string> = {
  'DATE:DESC': 'Date new → old',
  'DATE:ASC': 'Date old → new',
  'AMOUNT:DESC': 'Amount high → low',
  'AMOUNT:ASC': 'Amount low → high',
}

export function nextSort(sort: TransactionSort): TransactionSort {
  const index = SORT_OPTIONS.findIndex((option) => option.id === sortId(sort))
  return SORT_OPTIONS[(index + 1) % SORT_OPTIONS.length].sort
}
