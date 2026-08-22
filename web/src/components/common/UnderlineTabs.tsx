import type { ReactNode } from 'react'
import { underlineTabClassName, underlineTabsClassName } from './underlineTabsStyles'

export interface UnderlineTabItem<T extends string> {
  value: T
  children: ReactNode
}

export function UnderlineTabs<T extends string>({
  ariaLabel,
  className,
  items,
  value,
  onChange,
}: {
  ariaLabel: string
  className?: string
  items: UnderlineTabItem<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div aria-label={ariaLabel} className={underlineTabsClassName(className)} role="tablist">
      {items.map((item) => (
        <button
          aria-selected={value === item.value}
          className={underlineTabClassName(value === item.value)}
          key={item.value}
          onClick={() => onChange(item.value)}
          role="tab"
          type="button"
        >
          {item.children}
        </button>
      ))}
    </div>
  )
}
