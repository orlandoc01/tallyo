import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { underlineTabClassName, underlineTabsRuleClass } from './underlineTabsStyles'

const sheetTabsNavClass = `sticky top-0 z-[2] flex gap-5 ${underlineTabsRuleClass} bg-surface`

export function SheetTabs({ ariaLabel, items }: { ariaLabel: string; items: Array<{ to: string; children: ReactNode }> }) {
  return (
    <nav aria-label={ariaLabel} className={sheetTabsNavClass}>
      {items.map((item) => (
        <NavLink className={({ isActive }) => underlineTabClassName(isActive)} end key={item.to} to={item.to}>
          {item.children}
        </NavLink>
      ))}
    </nav>
  )
}

function tabId(prefix: string, id: string) {
  return `${prefix}-tab-${id}`
}

export function SheetTabButtons<T extends string>({ ariaLabel, idPrefix, items, onChange, value }: {
  ariaLabel: string
  idPrefix: string
  items: Array<{ id: T; children: ReactNode }>
  onChange: (id: T) => void
  value: T
}) {
  return (
    <div aria-label={ariaLabel} className={sheetTabsNavClass} role="tablist">
      {items.map((item) => (
        <button
          aria-controls={`${tabId(idPrefix, item.id)}-panel`}
          aria-selected={item.id === value}
          className={underlineTabClassName(item.id === value)}
          id={tabId(idPrefix, item.id)}
          key={item.id}
          onClick={() => onChange(item.id)}
          role="tab"
          type="button"
        >
          {item.children}
        </button>
      ))}
    </div>
  )
}

export function SheetTabPanel({ children, idPrefix, tabId: id }: { children: ReactNode; idPrefix: string; tabId: string }) {
  return <div aria-labelledby={tabId(idPrefix, id)} id={`${tabId(idPrefix, id)}-panel`} role="tabpanel">{children}</div>
}
