import { createContext } from 'react'
import type { NavItemId } from './navItems'

export interface NavLayout {
  navbar: NavItemId[]
  sidemenu: NavItemId[]
}

export interface NavLayoutContextValue {
  layout: NavLayout
  updateLayout: (layout: NavLayout) => void
}

export const NavLayoutContext = createContext<NavLayoutContextValue | null>(null)
