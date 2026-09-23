import clsx from 'clsx'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router'

export interface PillTab<T extends string> {
  badge?: number
  label: ReactNode
  to?: string
  value: T
}

export function PillTabs<T extends string>({ ariaLabel, fitContent = false, tabs, value, variant = 'bare', onChange }: {
  ariaLabel: string
  /** Track segments size to their labels instead of splitting the width equally. */
  fitContent?: boolean
  tabs: ReadonlyArray<PillTab<T>>
  value: T
  variant?: 'bare' | 'track'
  onChange?: (value: T) => void
}) {
  const track = variant === 'track'
  return (
    <div
      aria-label={ariaLabel}
      className={track ? 'flex rounded-md border border-border bg-surface-2 p-[3px]' : 'flex flex-wrap gap-1'}
      role="tablist"
    >
      {tabs.map((tab) => {
        const selected = tab.value === value
        const className = clsx(
          'inline-flex items-center justify-center font-medium transition-colors',
          track ? ['h-8 min-w-0 rounded text-[13px]', fitContent ? 'flex-auto gap-1 px-0.5' : 'flex-1 gap-1.5 px-2'] : 'h-8 gap-1.5 rounded-md px-3 text-sm',
          selected ? 'bg-border-strong text-text-1' : 'text-text-muted hover:text-text-2',
        )
        const content = (
          <>
            {tab.label}
            {tab.badge ? <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-border-strong px-1 text-[11px] font-semibold text-text-1">{tab.badge}</span> : null}
          </>
        )
        return tab.to ? (
          <NavLink aria-selected={selected} className={className} key={tab.value} role="tab" to={tab.to}>{content}</NavLink>
        ) : (
          <button aria-selected={selected} className={className} key={tab.value} onClick={() => onChange?.(tab.value)} role="tab" type="button">{content}</button>
        )
      })}
    </div>
  )
}
