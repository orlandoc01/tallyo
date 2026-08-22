import { ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import type { ReactNode } from 'react'

export function CollapsibleFilterSection({
  active,
  ariaLabel,
  children,
  expanded,
  label,
  summary,
  onToggle,
}: {
  active: boolean
  ariaLabel?: string
  children: ReactNode
  expanded: boolean
  label: string
  summary?: ReactNode
  onToggle: () => void
}) {
  return (
    <div>
      <button
        aria-label={ariaLabel}
        className={clsx(
          'touch-manipulation flex min-h-10 w-full items-center justify-between gap-3 rounded-xl border px-2 py-2 text-left text-sm font-semibold transition-colors dark:text-neutral-200',
          active
            ? 'border-brand-200 bg-brand-50/70 text-brand-900 ring-1 ring-inset ring-brand-200 dark:border-brand-400/30 dark:bg-brand-500/10 dark:text-brand-100 dark:ring-brand-400/30'
            : 'border-transparent text-neutral-700 [@media(hover:hover)]:hover:bg-neutral-50 dark:[@media(hover:hover)]:hover:bg-neutral-800/60',
        )}
        onClick={onToggle}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronDown aria-hidden="true" className={clsx('h-[1.125rem] w-[1.125rem] shrink-0 transition-transform', active ? 'text-brand-500 dark:text-brand-300' : 'text-neutral-400', expanded ? '' : '-rotate-90')} />
          <span className="truncate">{label}</span>
        </span>
        {summary ? <span className={clsx('shrink-0 text-xs font-semibold', active ? 'text-brand-700 dark:text-brand-200' : 'text-neutral-500 dark:text-neutral-400')}>{summary}</span> : null}
      </button>
      {expanded ? <div className="mt-3">{children}</div> : null}
    </div>
  )
}
