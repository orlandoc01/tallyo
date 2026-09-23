import clsx from 'clsx'
import type { ReactNode } from 'react'
import { ClickableRow } from './ClickableRow'
import { TickerChip } from './Tag'

const headerVariantClass = { default: 'px-4 pb-2', list: 'border-t border-border px-4 py-1.5', 'list-first': 'px-4 py-1.5' } as const

export function DataGridHeader({ children, gridTemplateColumns, variant = 'default' }: { children: ReactNode; gridTemplateColumns: string; variant?: keyof typeof headerVariantClass }) {
  return (
    <div className={clsx('grid items-center gap-3 text-xs text-text-muted', headerVariantClass[variant])} style={{ gridTemplateColumns }}>
      {children}
    </div>
  )
}

export function DataGridRow({ expanded, ariaLabel, children, gridTemplateColumns, highlighted = false, onClick, onHoverChange, pressed }: {
  expanded?: boolean
  ariaLabel?: string
  children: ReactNode
  gridTemplateColumns: string
  highlighted?: boolean
  onClick?: () => void
  onHoverChange?: (hovered: boolean) => void
  pressed?: boolean
}) {
  return (
    <ClickableRow
      expanded={expanded}
      ariaLabel={ariaLabel}
      className={clsx('group grid h-11 w-full items-center gap-3 border-t border-border px-4 text-left text-sm transition-colors duration-150', onClick && 'cursor-pointer hover:bg-raised', highlighted && 'bg-raised')}
      onClick={onClick}
      onHoverChange={onHoverChange}
      pressed={pressed}
      style={{ gridTemplateColumns }}
    >
      {children}
    </ClickableRow>
  )
}

export function DataGridSubRow({ ariaLabel, children, gridTemplateColumns, onClick }: {
  ariaLabel?: string
  children: ReactNode
  gridTemplateColumns: string
  onClick?: () => void
}) {
  return (
    <ClickableRow
      ariaLabel={ariaLabel}
      className={clsx('grid h-10 w-full items-center gap-3 bg-surface-2 pl-[42px] pr-4 text-left text-[13px] transition-colors duration-150', onClick && 'cursor-pointer hover:bg-raised')}
      onClick={onClick}
      style={{ gridTemplateColumns }}
    >
      {children}
    </ClickableRow>
  )
}

export const dataGridNumericCell = 'text-right tabular-nums'
export const dataGridTextCell = 'min-w-0 truncate'

export function ExpandGlyph({ color, dashed = false, expandable, open }: { color: string; dashed?: boolean; expandable: boolean; open: boolean }) {
  const dotClass = dashed ? 'rounded-full border border-dashed' : 'rounded-full'
  const dotStyle = dashed ? { borderColor: color } : { backgroundColor: color }
  if (!expandable) return <span aria-hidden className={clsx('mr-2 inline-block h-2 w-2 shrink-0', dotClass)} style={dotStyle} />
  return (
    <span aria-hidden className="relative mr-2 inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center">
      <span className={clsx('absolute inset-0 transition-opacity duration-150', dotClass, open ? 'opacity-0' : 'group-hover:opacity-0')} style={dotStyle} />
      <span className={clsx('absolute text-[10px] leading-none text-text-muted transition-[opacity,transform] duration-150', open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover:opacity-100')}>▶</span>
    </span>
  )
}

export interface ChildRowProps {
  chip: string
  name: string
  meta: string
  pct: string
  value: string
  onClick?: () => void
}

export function DataGridChildRow({ chip, gridTemplateColumns, meta, name, pct, trailing, value, onClick }: ChildRowProps & { gridTemplateColumns: string; trailing?: ReactNode }) {
  return (
    <DataGridSubRow gridTemplateColumns={gridTemplateColumns} onClick={onClick}>
      <span className={clsx(dataGridTextCell, 'flex items-center gap-2')}>
        {onClick ? <span className="sr-only">Edit </span> : null}
        <TickerChip>{chip}</TickerChip>
        <span className="truncate text-text-1">{name}</span>
        <span className="truncate text-text-muted">{meta}</span>
      </span>
      <span className={clsx(dataGridNumericCell, 'text-text-3')}>{pct}</span>
      <span className={clsx(dataGridNumericCell, 'text-text-1')}>{value}</span>
      {trailing}
    </DataGridSubRow>
  )
}

export function MobileChildRow({ chip, meta, name, pct, trailing, value, onClick }: ChildRowProps & { trailing?: ReactNode }) {
  return (
    <ClickableRow className="flex min-h-[46px] w-full items-center gap-2.5 bg-surface-2 py-1.5 pl-[34px] pr-4 text-left" onClick={onClick}>
      {onClick ? <span className="sr-only">Edit </span> : null}
      <TickerChip>{chip}</TickerChip>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-text-1">{name}</span>
        <span className="block truncate text-[11px] text-text-muted">{meta} · {pct}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[13px] text-text-1">{value}</span>
        {trailing}
      </span>
    </ClickableRow>
  )
}
