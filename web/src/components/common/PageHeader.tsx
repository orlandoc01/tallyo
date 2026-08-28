import clsx from 'clsx'
import type { ReactNode } from 'react'

export function PageHeader({ actions, children, className, title }: {
  actions?: ReactNode
  children?: ReactNode
  className?: string
  title: string
}) {
  return (
    <header className={clsx('flex min-w-0 items-center justify-between gap-4', !children && !actions && 'hidden lg:flex', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-5">
        <h1 className="hidden shrink-0 text-2xl font-bold tracking-tight text-neutral-950 lg:block">{title}</h1>
        {children}
      </div>
      {actions ? <div className="ml-auto hidden shrink-0 items-center gap-3 lg:flex">{actions}</div> : null}
    </header>
  )
}
