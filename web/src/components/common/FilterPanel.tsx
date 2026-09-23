import clsx from 'clsx'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './Button'

export function FilterPanel({ actions, activeRow, caretRight, children, clearable, onClear, trailing, variant = 'inset' }: {
  actions?: ReactNode
  activeRow?: ReactNode
  caretRight?: number
  children: ReactNode
  clearable: boolean
  onClear: () => void
  trailing?: ReactNode
  variant?: 'card' | 'inset' | 'inset-2'
}) {
  const card = variant === 'card'
  const surface2 = variant === 'inset-2'
  return (
    <div className={clsx('relative rounded-lg border', card ? 'z-20 -mt-1 border-border bg-surface px-4 py-3' : surface2 ? 'mt-3 border-border bg-surface-2 px-4 py-3' : 'mt-3 border-border-strong bg-raised px-3 py-2.5')}>
      {caretRight !== undefined ? (
        <span aria-hidden className={clsx('absolute -top-[7px] h-3 w-3 rotate-45 border-l border-t', surface2 ? 'border-border bg-surface-2' : card ? 'border-border-strong bg-surface' : 'border-border-strong bg-raised')} style={{ right: caretRight }} />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <Button disabled={!clearable} onClick={onClear} size="sm" variant="ghost">Clear filters</Button>
          {trailing}
        </div>
      </div>
      {activeRow ? <div className="mt-3 border-t border-border pt-2.5">{activeRow}</div> : null}
    </div>
  )
}

export function ActiveFilterRow({ children, count }: { children: ReactNode; count?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-text-muted">Active:</span>
      {children}
      {count ? <span className="ml-auto text-xs text-text-muted">{count}</span> : null}
    </div>
  )
}

export function ActiveFilterPill({ kind, onRemove, size = 'md', value }: { kind: string; onRemove: () => void; size?: 'sm' | 'md'; value: string }) {
  return (
    <span className={clsx('inline-flex max-w-full items-center gap-1.5 rounded-full bg-raised-nav pl-2.5 pr-1 text-xs text-text-1', size === 'sm' ? 'h-[26px]' : 'h-6')}>
      <span className="text-text-muted">{kind}</span>
      <span className="truncate">{value}</span>
      <button aria-label={`Remove ${kind} filter: ${value}`} className="flex h-4 w-4 items-center justify-center rounded-full text-text-muted hover:bg-hover hover:text-text-1" onClick={onRemove} type="button">
        <X aria-hidden className="h-3 w-3" />
      </button>
    </span>
  )
}
