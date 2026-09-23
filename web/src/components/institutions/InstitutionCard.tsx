import clsx from 'clsx'
import type { ReactNode } from 'react'
import { institutionColor } from '../../utils/colors'
import type { SyncTone } from './accountCards'

export function InstitutionCard({ title, titleAttr, subtitle, chips, menu, children }: {
  title: string
  titleAttr?: string
  subtitle: ReactNode
  chips?: ReactNode
  menu?: ReactNode
  children?: ReactNode
}) {
  return (
    <>
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 lg:gap-3.5 lg:py-3.5">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: institutionColor(title) }}>
          {title.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1 lg:min-w-[180px]">
          <h2 className="truncate text-[15px] font-semibold text-text-1" title={titleAttr}>{title}</h2>
          <p className="truncate text-xs text-text-muted">{subtitle}</p>
        </div>
        {chips ? <div className="order-last flex basis-full flex-wrap items-center gap-2 text-xs text-text-muted lg:order-none lg:basis-auto">{chips}</div> : null}
        {menu}
      </header>
      {children}
    </>
  )
}

const toneDotClass: Record<SyncTone, string> = { positive: 'bg-positive', warning: 'bg-warning' }

export function ProviderChip({ tone, children }: { tone: SyncTone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-border-strong bg-raised px-2 py-0.5 text-xs text-text-muted">
      <span aria-hidden className={clsx('h-1.5 w-1.5 rounded-full', toneDotClass[tone])} />
      {children}
    </span>
  )
}
