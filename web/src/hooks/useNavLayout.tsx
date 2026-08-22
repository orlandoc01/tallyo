import { useContext } from 'react'
import { NavLayoutContext, type NavLayoutContextValue } from './navLayoutContext'

export function useNavLayout(): NavLayoutContextValue {
  const ctx = useContext(NavLayoutContext)
  if (!ctx) {
    throw new Error('useNavLayout must be used within a NavLayoutProvider')
  }
  return ctx
}
