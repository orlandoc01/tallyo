import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { initialSetupState } from './setupState'
import { SetupContext, type SetupContextValue } from './setupContextValue'

export function SetupProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialSetupState)
  const value = useMemo<SetupContextValue>(() => ({ ...state, updateSetup: (patch) => setState((prev) => ({ ...prev, ...patch })) }), [state])

  return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>
}
