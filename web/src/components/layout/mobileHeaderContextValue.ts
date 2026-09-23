import { createContext } from 'react'
import type { ReactNode } from 'react'

export interface MobileHeaderContextValue {
  filterOpen: boolean
  filtersActive: boolean
  openFilter: () => void
  closeFilter: () => void
  setFiltersActive: (active: boolean) => void
  headerActions: ReactNode | null
  setHeaderActions: (actions: ReactNode | null) => void
}

export const MobileHeaderContext = createContext<MobileHeaderContextValue | null>(null)
