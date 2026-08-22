import { useContext, useEffect } from 'react'
import type { ReactNode } from 'react'
import { MobileHeaderContext } from './mobileHeaderContextValue'

export function useMobileHeader() {
  const ctx = useContext(MobileHeaderContext)
  if (!ctx) throw new Error('useMobileHeader must be used inside MobileHeaderProvider')
  return ctx
}

export function useMobileHeaderActions(actions: ReactNode | null) {
  const { setHeaderActions } = useMobileHeader()

  useEffect(() => {
    setHeaderActions(actions)
    return () => setHeaderActions(null)
  }, [actions, setHeaderActions])
}
