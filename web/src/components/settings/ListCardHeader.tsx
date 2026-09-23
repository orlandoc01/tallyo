import clsx from 'clsx'
import type { ReactNode } from 'react'

export function ListCardHeader({ actions, description, title }: { actions?: ReactNode; description?: string; title: string }) {
  return (
    <div className={clsx('flex flex-wrap items-center justify-between gap-3 px-4', description ? 'py-3.5' : 'min-h-12 py-2')}>
      <div>
        <h2 className="text-sm font-semibold text-text-1">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}
