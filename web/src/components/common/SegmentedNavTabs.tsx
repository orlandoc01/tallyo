import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { underlineTabClassName, underlineTabsClassName } from './underlineTabsStyles'

export interface SegmentedNavTab {
  to: string
  children: ReactNode
}

export function SegmentedNavTabs({ ariaLabel, className, items }: { ariaLabel: string; className?: string; items: SegmentedNavTab[] }) {
  return (
    <nav aria-label={ariaLabel} className={underlineTabsClassName(className)}>
      {items.map((item) => (
        <NavLink
          className={({ isActive }) => underlineTabClassName(isActive)}
          end
          key={item.to}
          to={item.to}
        >
          {item.children}
        </NavLink>
      ))}
    </nav>
  )
}
