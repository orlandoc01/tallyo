import { createContext } from 'react'
import type { SetupState } from './setupState'

export type SetupContextValue = SetupState & {
  updateSetup: (patch: Partial<SetupState>) => void
}

export const SetupContext = createContext<SetupContextValue | null>(null)
