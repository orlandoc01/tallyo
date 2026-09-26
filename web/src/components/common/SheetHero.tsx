import clsx from 'clsx'
import type { ReactNode } from 'react'

export function SheetAvatar({ className, color, glyph }: { className?: string; color?: string; glyph: ReactNode }) {
  return (
    <span
      aria-hidden
      className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-semibold', className ?? (color ? 'text-white' : 'bg-raised text-text-1'))}
      style={color ? { backgroundColor: color } : undefined}
    >
      {glyph}
    </span>
  )
}

export function SheetHero({ avatar, sub, title, value, valueClassName, valueSub }: {
  avatar: ReactNode
  sub?: ReactNode
  title: ReactNode
  value?: ReactNode
  valueClassName?: string
  valueSub?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 pb-4 pt-1">
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold text-text-1">{title}</div>
        {sub ? <div className="truncate text-xs text-text-3">{sub}</div> : null}
      </div>
      {value !== undefined ? (
        <div className="shrink-0 text-right">
          <div className={clsx('text-base font-semibold tabular-nums', valueClassName ?? 'text-text-1')}>{value}</div>
          {valueSub ? <div className="text-xs tabular-nums text-text-3">{valueSub}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

export interface SheetKeyValue {
  k: string
  v: ReactNode
  mono?: boolean
}

export function SheetMeta({ rows }: { rows: SheetKeyValue[] }) {
  return (
    <dl className="flex flex-col gap-1.5 pb-3.5 text-xs">
      {rows.map((row) => (
        <div className="flex justify-between gap-3" key={row.k}>
          <dt className="text-text-3">{row.k}</dt>
          <dd className="min-w-0 truncate text-right text-text-2">{row.v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function SheetFoot({ rows }: { rows: SheetKeyValue[] }) {
  return (
    <dl className="flex flex-col gap-1.5 border-t border-border pb-4 pt-3.5 text-[11px] text-text-3">
      {rows.map((row) => (
        <div className="flex justify-between gap-3" key={row.k}>
          <dt>{row.k}</dt>
          <dd className={clsx('min-w-0 truncate text-right', row.mono && 'font-mono')}>{row.v}</dd>
        </div>
      ))}
    </dl>
  )
}
