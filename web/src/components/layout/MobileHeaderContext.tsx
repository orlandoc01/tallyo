import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { MobileHeaderContext, type MobileHeaderContextValue } from './mobileHeaderContextValue'

export function MobileHeaderProvider({ children }: { children: ReactNode }) {
  const [filterOpen, setFilterOpen] = useState(false)
  const [filtersActive, setFiltersActive] = useState(false)
  const [headerLeading, setHeaderLeading] = useState<ReactNode | null>(null)
  const [headerActions, setHeaderActions] = useState<ReactNode | null>(null)

  const openFilter = useCallback(() => setFilterOpen(true), [])
  const closeFilter = useCallback(() => setFilterOpen(false), [])

  const value = useMemo<MobileHeaderContextValue>(
    () => ({
      filterOpen,
      filtersActive,
      openFilter,
      closeFilter,
      setFiltersActive,
      headerLeading,
      setHeaderLeading,
      headerActions,
      setHeaderActions,
    }),
    [filterOpen, filtersActive, openFilter, closeFilter, headerLeading, headerActions],
  )

  return (
    <MobileHeaderContext.Provider value={value}>
      {children}
    </MobileHeaderContext.Provider>
  )
}
