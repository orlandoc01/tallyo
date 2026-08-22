import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import { Children, type MouseEventHandler, type ReactNode } from 'react'

interface OneLevelGroupProps {
  children?: ReactNode
  className?: string
  expanded: boolean
  expandable?: boolean
  expandButtonLabel: string
  header: ReactNode
  headerActive?: boolean
  headerClassName?: string
  headerClickToggles?: boolean
  headerPressed?: boolean
  onHeaderClick?: () => void
  onMouseEnter?: MouseEventHandler<HTMLElement>
  onMouseLeave?: MouseEventHandler<HTMLElement>
  onToggle: () => void
}

export function OneLevelGroup({
  children,
  className,
  expanded,
  expandable = true,
  expandButtonLabel,
  header,
  headerActive = false,
  headerClassName,
  headerClickToggles = false,
  headerPressed,
  onHeaderClick,
  onMouseEnter,
  onMouseLeave,
  onToggle,
}: OneLevelGroupProps) {
  const canExpand = expandable && Children.count(children) > 0
  const headerAction = onHeaderClick ?? (headerClickToggles && canExpand ? onToggle : undefined)
  const headerInteractive = Boolean(headerAction || canExpand)

  return (
    <section
      className={clsx(
        'overflow-hidden rounded-2xl border border-neutral-100 bg-neutral-50 transition dark:border-neutral-800 dark:bg-neutral-900/70',
        className,
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className={clsx(
          'm-1 flex items-center gap-1 rounded-xl border border-transparent p-2 transition-colors',
          headerInteractive && !headerActive && '[@media(hover:hover)]:hover:bg-neutral-100 dark:[@media(hover:hover)]:hover:bg-neutral-800/70',
          headerActive && 'bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:ring-brand-400/30',
        )}
      >
        {canExpand ? (
          <button
            aria-label={expandButtonLabel}
            className="rounded-lg p-1 text-neutral-400 transition hover:text-neutral-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/40 dark:hover:text-neutral-200 dark:focus-visible:ring-brand-400/30"
            onClick={onToggle}
            type="button"
          >
            <ChevronDown className={clsx('h-4 w-4 transition', expanded ? '' : '-rotate-90')} />
          </button>
        ) : (
          <span className="h-6 w-6" />
        )}
        {headerAction ? (
          <button
            aria-expanded={headerClickToggles && canExpand ? expanded : undefined}
            aria-pressed={headerPressed}
            className={clsx(
              'flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl p-1 text-left transition focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/40 dark:focus-visible:ring-brand-400/30',
              headerClassName,
            )}
            onClick={headerAction}
            type="button"
          >
            {header}
          </button>
        ) : (
          <div
            className={clsx(
              'flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl p-1 text-left transition focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/40 dark:focus-visible:ring-brand-400/30',
              headerClassName,
            )}
          >
            {header}
          </div>
        )}
      </div>
      {expanded && canExpand ? (
        <div className="space-y-2 border-t border-neutral-100 p-3 pt-2 dark:border-neutral-800">{children}</div>
      ) : null}
    </section>
  )
}

interface OneLevelGroupRowProps {
  ariaLabel?: string
  children: ReactNode
  className?: string
  onClick?: () => void
  pressed?: boolean
  selected?: boolean
}

export function OneLevelGroupRow({ ariaLabel, children, className, onClick, pressed, selected = false }: OneLevelGroupRowProps) {
  const rowClassName = clsx(
    'w-full rounded-xl border border-transparent p-3 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/40 dark:focus-visible:ring-brand-400/30',
    selected
      ? 'bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:ring-brand-400/30'
      : 'bg-neutral-50 dark:bg-neutral-900/70',
    onClick && !selected && '[@media(hover:hover)]:hover:bg-neutral-100 dark:[@media(hover:hover)]:hover:bg-neutral-800/70',
    className,
  )

  if (!onClick) {
    return <div className={rowClassName}>{children}</div>
  }

  return (
    <button aria-label={ariaLabel} aria-pressed={pressed} className={rowClassName} onClick={onClick} type="button">
      {children}
    </button>
  )
}
