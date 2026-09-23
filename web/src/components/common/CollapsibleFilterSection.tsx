import { ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import type { ReactNode } from 'react'

export function CollapsibleFilterSection({
  active,
  children,
  expanded,
  label,
  summary,
  onToggle,
}: {
  active: boolean
  children: ReactNode
  expanded: boolean
  label: string
  summary?: ReactNode
  onToggle: () => void
}) {
  return (
    <div className="border-t border-border">
      <button
        aria-expanded={expanded}
        className="touch-manipulation flex min-h-[52px] w-full items-center justify-between gap-3 text-left text-sm font-medium text-text-1"
        onClick={onToggle}
        type="button"
      >
        <span className="truncate">{label}</span>
        <span className="flex shrink-0 items-center gap-3">
          {summary ? <span className={clsx('text-[13px] font-normal', active ? 'text-accent' : 'text-text-muted')}>{summary}</span> : null}
          <ChevronDown aria-hidden="true" className={clsx('h-[11px] w-[11px] text-text-muted transition-transform', expanded && 'rotate-180')} />
        </span>
      </button>
      {expanded ? <div className="pb-2">{children}</div> : null}
    </div>
  )
}
