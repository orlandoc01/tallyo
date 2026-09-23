import clsx from 'clsx'
import type { ReactNode } from 'react'

export function StatBlock({ label, size = 'md', sublabel, value }: { label: string; size?: 'md' | 'lg'; sublabel?: ReactNode; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={clsx('text-text-muted', size === 'lg' ? 'text-[13px]' : 'text-[11px] lg:text-xs')}>{label}</div>
      <div className={clsx('mt-0.5 truncate font-semibold text-text-1 lg:tracking-[-0.3px]', size === 'lg' ? 'text-xl leading-[26px] lg:text-[22px] lg:leading-7' : 'text-sm lg:text-lg lg:leading-6')}>{value}</div>
      {sublabel ? <div className="mt-0.5 text-xs text-text-muted">{sublabel}</div> : null}
    </div>
  )
}

export function StatGrid({ children, className, columns = 3, layout = 'grid' }: { children: ReactNode; className?: string; columns?: 2 | 3; layout?: 'grid' | 'row' }) {
  return (
    <div className={clsx('grid gap-y-3.5', layout === 'row' ? 'lg:flex lg:gap-8' : 'lg:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] lg:gap-x-8 lg:gap-y-4', columns === 2 ? 'grid-cols-2 gap-x-4' : 'grid-cols-3 gap-x-3', className)}>
      {children}
    </div>
  )
}
