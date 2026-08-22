import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { TransactionSelectionContext, type TransactionSelectionContextValue } from './transactionSelectionContextValue'

export function TransactionSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [isBulkMode, setIsBulkMode] = useState(false)

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids))
  }, [])

  const enterBulkMode = useCallback(() => setIsBulkMode(true), [])
  const exitBulkMode = useCallback(() => {
    setIsBulkMode(false)
    setSelectedIds(new Set())
  }, [])

  const value = useMemo<TransactionSelectionContextValue>(
    () => ({
      selectedIds,
      isBulkMode,
      toggleSelected,
      clearSelection,
      enterBulkMode,
      exitBulkMode,
      selectAll,
    }),
    [selectedIds, isBulkMode, toggleSelected, clearSelection, enterBulkMode, exitBulkMode, selectAll],
  )

  return (
    <TransactionSelectionContext.Provider value={value}>
      {children}
    </TransactionSelectionContext.Provider>
  )
}
