import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { PageToolbarButton } from './PageToolbar'

// Shared chrome for the filter dropdowns (analysis, assets, rules): a toggle
// button with an active-count label, a click-away backdrop, and a panel header
// with a "Clear all" action. Each caller supplies its own panel width/colors
// via panelClassName and its own filter controls as children.
export function FilterDropdownShell({
  activeFilterCount,
  buttonAriaLabel,
  buttonClassName,
  buttonContent,
  wrapperClassName = 'relative',
  panelClassName,
  dark = false,
  onClear,
  children,
}: {
  activeFilterCount: number
  buttonAriaLabel?: string
  buttonClassName?: string
  buttonContent?: ReactNode
  wrapperClassName?: string
  panelClassName: string
  dark?: boolean
  onClear: () => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const label = buttonContent ?? (activeFilterCount ? `Filters: ${activeFilterCount} selected` : 'Filters')

  return (
    <div className={wrapperClassName}>
      {buttonClassName ? (
        <button
          aria-label={buttonAriaLabel}
          aria-expanded={open}
          className={clsx(buttonClassName, open || activeFilterCount ? 'text-brand-700 ring-1 ring-brand-300' : null)}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {label}
        </button>
      ) : (
        <PageToolbarButton active={open || activeFilterCount > 0} aria-label={buttonAriaLabel} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          {label}
        </PageToolbarButton>
      )}
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={panelClassName}>
            <div className="mb-4 flex items-center justify-between">
              <span className={`text-sm font-semibold text-neutral-900${dark ? ' dark:text-neutral-100' : ''}`}>Filters</span>
              {activeFilterCount ? (
                <button className={`text-xs font-semibold text-brand-700 hover:text-brand-900${dark ? ' dark:text-brand-300' : ''}`} onClick={onClear} type="button">
                  Clear all
                </button>
              ) : null}
            </div>
            {children}
          </div>
        </>
      ) : null}
    </div>
  )
}
