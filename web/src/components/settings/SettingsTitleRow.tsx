import clsx from 'clsx'
import type { ReactNode } from 'react'

export function SettingsTitleRow({ action, subtitle, title }: { action?: ReactNode; subtitle?: string; title: string }) {
  return (
    <div className={clsx('flex flex-wrap items-start justify-between gap-3 lg:min-h-8', !subtitle && 'max-lg:sr-only')}>
      <div className="min-w-0">
        <h1 className="sr-only text-lg font-semibold tracking-[-0.3px] text-text-1 lg:not-sr-only">{title}</h1>
        {subtitle ? <p className="text-[13px] text-text-muted lg:mt-0.5">{subtitle}</p> : null}
      </div>
      {action ? <div className="hidden shrink-0 lg:block">{action}</div> : null}
    </div>
  )
}
