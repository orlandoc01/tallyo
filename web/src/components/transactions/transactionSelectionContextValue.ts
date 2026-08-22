import { createContext } from 'react'

export interface TransactionSelectionContextValue {
  selectedIds: Set<string>
  isBulkMode: boolean
  toggleSelected: (id: string) => void
  clearSelection: () => void
  enterBulkMode: () => void
  exitBulkMode: () => void
  selectAll: (ids: string[]) => void
}

export const TransactionSelectionContext = createContext<TransactionSelectionContextValue | null>(null)
