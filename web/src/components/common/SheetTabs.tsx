import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { underlineTabClassName } from './underlineTabsStyles'

export function SheetTabs({ ariaLabel, items }: { ariaLabel: string; items: Array<{ to: string; children: ReactNode }> }) {
  return (
    <nav aria-label={ariaLabel} className="sticky top-0 z-[2] flex gap-5 border-b border-border bg-surface">
      {items.map((item) => (
        <NavLink className={({ isActive }) => underlineTabClassName(isActive)} end key={item.to} to={item.to}>
          {item.children}
        </NavLink>
      ))}
    </nav>
  )
}
