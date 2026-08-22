import { useContext } from 'react'
import { SetupContext } from './setupContextValue'

export function useSetup() {
  const context = useContext(SetupContext)
  if (!context) throw new Error('useSetup must be used inside SetupProvider')
  return context
}
