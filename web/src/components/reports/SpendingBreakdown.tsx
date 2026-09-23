import clsx from 'clsx'
import { useMemo, useState } from 'react'
import type { SpendingPeriod } from '../../types/domain'
import { useIsMobile } from '../../hooks/useIsMobile'
import { formatCurrency, formatSignedCurrency } from '../../utils/currency'
import type { GroupBy } from '../../utils/spending'
import { Button } from '../common/Button'
import { ClickableRow } from '../common/ClickableRow'
import { Donut } from '../common/Donut'
import { DottedBar } from '../common/DottedBar'
import { type BreakdownItem, breakdownItemCount, breakdownItems, maxVisibleFor, nonZeroSorted, pieItems } from './spendingBreakdownItems'

export type ChartView = 'bar' | 'pie'

export interface SpendingCategoryFocus {
  id: string
  categoryIds: string[]
}

const PIE_GRID = 'minmax(0,1fr) 70px 90px 110px'
const BAR_GRID = 'minmax(160px,240px) minmax(0,1fr) 70px 110px'

interface RowsProps {
  focusedId: string | null
  hoveredId?: string | null
  items: BreakdownItem[]
  onHover?: (id: string | null) => void
  onToggle?: (item: BreakdownItem) => void
}

export function SpendingBreakdown({ expanded = false, focusedCategoryId = null, groupBy, onCategoryFocusChange, onToggleExpanded, period, view = 'bar' }: {
  expanded?: boolean
  focusedCategoryId?: string | null
  groupBy?: GroupBy
  onCategoryFocusChange?: (focus: SpendingCategoryFocus | null) => void
  onToggleExpanded?: () => void
  period?: SpendingPeriod
  view?: ChartView
}) {
  const isMobile = useIsMobile()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const categories = useMemo(() => nonZeroSorted(period?.categories ?? []), [period?.categories])
  const items = useMemo(() => breakdownItems(categories, groupBy, expanded), [categories, groupBy, expanded])
  const slices = useMemo(() => pieItems(items, expanded), [items, expanded])
  const totalCount = breakdownItemCount(categories, groupBy)

  if (!period || categories.length === 0) {
    return <p className="p-8 text-[13px] text-text-muted">No spending data for this period.</p>
  }

  const toggle = onCategoryFocusChange ? (item: BreakdownItem) => onCategoryFocusChange(focusedCategoryId === item.id ? null : { id: item.id, categoryIds: item.categoryIds }) : undefined
  const expandButton = onToggleExpanded && totalCount > maxVisibleFor(groupBy) ? (
    <div className="mt-3 flex justify-center">
      <Button onClick={onToggleExpanded} size="sm" variant="ghost">{expanded ? 'Show less' : `Show all ${totalCount} categories`}</Button>
    </div>
  ) : null

  if (view === 'bar') {
    return (
      <div className={isMobile ? '-mx-4 mt-5' : 'mt-7'}>
        {isMobile ? <MobileBarRows focusedId={focusedCategoryId} items={items} onToggle={toggle} /> : <BarRows focusedId={focusedCategoryId} items={items} onToggle={toggle} />}
        {expandButton}
      </div>
    )
  }

  const donut = (
    <div className={clsx('relative mx-auto w-full', isMobile ? 'max-w-[190px]' : 'max-w-[280px]')}>
      <Donut ariaLabel="Spending by category" hoveredKey={hoveredId} innerRadius={74} onHover={toggle ? setHoveredId : undefined} onSelect={toggle ? (key) => { const item = slices.find((slice) => slice.id === key); if (item) toggle(item) } : undefined} selectedKey={focusedCategoryId} slices={slices.map((item) => ({ key: item.id, label: item.name, value: item.total, color: item.color }))} />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[13px] text-text-muted">{groupBy === 'group' ? 'All groups' : 'All categories'}</span>
        <span className="text-xl font-semibold tracking-[-0.3px] text-text-1">{formatCurrency(period.total)}</span>
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <div className="mt-5">
        {donut}
        <div className="-mx-4 mt-4">
          <MobilePieRows focusedId={focusedCategoryId} items={slices} onToggle={toggle} />
        </div>
        {expandButton}
      </div>
    )
  }

  return (
    <div className="mt-7 grid grid-cols-[minmax(200px,280px)_minmax(0,1fr)] items-center gap-8">
      {donut}
      <div>
        <PieRows focusedId={focusedCategoryId} hoveredId={hoveredId} items={slices} onHover={setHoveredId} onToggle={toggle} />
        {expandButton}
      </div>
    </div>
  )
}

function rowLabel(item: BreakdownItem) {
  return `${item.emoji} ${item.name} ${formatSignedCurrency(item.total)}`
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
}

function PieRows({ focusedId, hoveredId, items, onHover, onToggle }: RowsProps) {
  return (
    <div>
      <div className="grid gap-3 border-b border-border pb-2 text-xs text-text-muted" style={{ gridTemplateColumns: PIE_GRID }}>
        <span>Category</span>
        <span className="text-right">Txns</span>
        <span className="text-right">% of Spend</span>
        <span className="text-right">Amount</span>
      </div>
      {items.map((item) => (
        <ClickableRow
          ariaLabel={rowLabel(item)}
          className={clsx('grid h-[34px] w-full items-center gap-3 text-left text-[13px] transition-colors duration-150', onToggle && 'hover:bg-raised', (focusedId === item.id || hoveredId === item.id) && 'bg-raised')}
          key={item.id}
          onClick={onToggle ? () => onToggle(item) : undefined}
          onHoverChange={onHover ? (hovered) => onHover(hovered ? item.id : null) : undefined}
          pressed={onToggle ? focusedId === item.id : undefined}
          style={{ gridTemplateColumns: PIE_GRID }}
        >
          <span className="flex min-w-0 items-center gap-2 text-text-1"><Dot color={item.color} /><span className="truncate">{item.emoji} {item.name}</span></span>
          <span className="text-right tabular-nums text-text-3">{item.transactionCount}</span>
          <span className="text-right tabular-nums text-text-3">{item.percentOfTotal.toFixed(1)}%</span>
          <span className="text-right tabular-nums text-text-3">{formatSignedCurrency(item.total)}</span>
        </ClickableRow>
      ))}
    </div>
  )
}

function BarRows({ focusedId, items, onToggle }: RowsProps) {
  const maxAbsTotal = Math.max(...items.map((item) => Math.abs(item.total)), 0)
  return (
    <div>
      <div className="grid gap-4 border-b border-border pb-2 text-xs text-text-muted" style={{ gridTemplateColumns: BAR_GRID }}>
        <span>Category</span>
        <span>Weight</span>
        <span className="text-right">% of Spend</span>
        <span className="text-right">Amount</span>
      </div>
      {items.map((item) => (
        <ClickableRow
          ariaLabel={rowLabel(item)}
          className={clsx('grid h-9 w-full items-center gap-4 text-left text-[13px] transition-colors duration-150', onToggle && 'hover:bg-raised', focusedId === item.id && 'bg-raised')}
          key={item.id}
          onClick={onToggle ? () => onToggle(item) : undefined}
          pressed={onToggle ? focusedId === item.id : undefined}
          style={{ gridTemplateColumns: BAR_GRID }}
        >
          <span className="truncate text-text-1">{item.emoji} {item.name}</span>
          <DottedBar color={item.color} height={6} percent={maxAbsTotal > 0 ? (Math.abs(item.total) / maxAbsTotal) * 100 : 0} />
          <span className="text-right tabular-nums text-text-3">{item.percentOfTotal.toFixed(1)}%</span>
          <span className="text-right tabular-nums text-text-1">{formatSignedCurrency(item.total)}</span>
        </ClickableRow>
      ))}
    </div>
  )
}

function MobilePieRows({ focusedId, items, onToggle }: RowsProps) {
  return (
    <div>
      <div className="flex justify-between px-4 pb-2 text-xs text-text-muted">
        <span>Category</span>
        <span>Amount · Share</span>
      </div>
      {items.map((item) => (
        <ClickableRow
          ariaLabel={rowLabel(item)}
          className={clsx('flex min-h-[46px] w-full items-center gap-3 border-t border-border px-4 py-1 text-left', focusedId === item.id && 'bg-raised')}
          key={item.id}
          onClick={onToggle ? () => onToggle(item) : undefined}
          pressed={onToggle ? focusedId === item.id : undefined}
        >
          <Dot color={item.color} />
          <span className="min-w-0 flex-1 truncate text-sm text-text-1">{item.emoji} {item.name}</span>
          <span className="text-right">
            <span className="block text-sm tabular-nums text-text-1">{formatSignedCurrency(item.total)}</span>
            <span className="block text-[11px] tabular-nums text-text-muted">{item.percentOfTotal.toFixed(1)}% · {item.transactionCount} txns</span>
          </span>
        </ClickableRow>
      ))}
    </div>
  )
}

function MobileBarRows({ focusedId, items, onToggle }: RowsProps) {
  const maxAbsTotal = Math.max(...items.map((item) => Math.abs(item.total)), 0)
  return (
    <div>
      {items.map((item) => (
        <ClickableRow
          ariaLabel={rowLabel(item)}
          className={clsx('block w-full border-t border-border px-4 py-2.5 text-left', focusedId === item.id && 'bg-raised')}
          key={item.id}
          onClick={onToggle ? () => onToggle(item) : undefined}
          pressed={onToggle ? focusedId === item.id : undefined}
        >
          <span className="flex items-center justify-between gap-3 text-[13px]">
            <span className="truncate text-text-1">{item.emoji} {item.name}</span>
            <span className="tabular-nums text-text-1">{formatSignedCurrency(item.total)}</span>
          </span>
          <span className="mt-1.5 flex items-center gap-2">
            <DottedBar color={item.color} height={6} percent={maxAbsTotal > 0 ? (Math.abs(item.total) / maxAbsTotal) * 100 : 0} />
            <span className="min-w-[40px] text-right text-[11px] tabular-nums text-text-muted">{item.percentOfTotal.toFixed(1)}%</span>
          </span>
        </ClickableRow>
      ))}
    </div>
  )
}
