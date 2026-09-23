import clsx from 'clsx'
import { ClickableRow } from '../common/ClickableRow'
import { DataGridChildRow, DataGridHeader, DataGridRow, ExpandGlyph, MobileChildRow, dataGridNumericCell, dataGridTextCell } from '../common/DataGrid'
import { DeltaText } from '../common/DeltaText'
import { displayAmount } from './amountDisplay'
import type { AllocationChild, AllocationRow } from './allocationRows'
import { formatCurrency } from '../../utils/currency'

const GRID_COLUMNS = 'minmax(150px,1fr) minmax(56px,120px) minmax(90px,160px) minmax(90px,160px)'

interface AllocationTableProps {
  amountsHidden: boolean
  changeLabel: string
  hoveredKey: string | null
  invertChange: boolean
  open: Record<string, boolean>
  pctLabel: string
  rows: AllocationRow[]
  selectedKey: string | null
  onHover: (key: string | null) => void
  onRowClick: (row: AllocationRow) => void
}

function ChangeCell({ amountsHidden, invert, row, size }: { amountsHidden: boolean; invert: boolean; row: AllocationRow; size: 'sm' | 'md' }) {
  if (!row.change) return <span className="text-text-muted">—</span>
  return <DeltaText changePct={row.change.changePct} changeUSD={row.change.changeUSD} invert={invert} masked={amountsHidden} size={size} />
}

export function AllocationTable({ amountsHidden, changeLabel, hoveredKey, invertChange, open, pctLabel, rows, selectedKey, onHover, onRowClick }: AllocationTableProps) {
  return (
    <div className="-mx-6 mt-6 hidden overflow-x-auto px-6 lg:block">
      <div className="min-w-[520px]">
        <DataGridHeader gridTemplateColumns={GRID_COLUMNS}>
          <span>Asset</span>
          <span className={dataGridNumericCell}>{pctLabel}</span>
          <span className={dataGridNumericCell}>Value</span>
          <span className={dataGridNumericCell}>Change · {changeLabel}</span>
        </DataGridHeader>
        {rows.map((row) => {
          const expanded = row.expandable && (open[row.key] ?? false)
          return (
            <div key={row.key}>
              <DataGridRow gridTemplateColumns={GRID_COLUMNS} highlighted={hoveredKey === row.key || selectedKey === row.key} onClick={() => onRowClick(row)} onHoverChange={(hovered) => onHover(hovered ? row.key : null)} pressed={selectedKey === row.key}>
                <span className={clsx(dataGridTextCell, 'flex items-center font-medium text-text-1')}><ExpandGlyph color={row.color} expandable={row.expandable} open={expanded} /><span className="truncate">{row.label}</span></span>
                <span className={clsx(dataGridNumericCell, 'text-text-2')}>{row.pct.toFixed(1)}%</span>
                <span className={clsx(dataGridNumericCell, 'text-text-1')}>{displayAmount(amountsHidden, formatCurrency(row.value))}</span>
                <span className={dataGridNumericCell}><ChangeCell amountsHidden={amountsHidden} invert={invertChange} row={row} size="md" /></span>
              </DataGridRow>
              {expanded ? row.children.map((child) => <DesktopChildRow amountsHidden={amountsHidden} child={child} key={child.key} />) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DesktopChildRow({ amountsHidden, child }: { amountsHidden: boolean; child: AllocationChild }) {
  return <DataGridChildRow chip={child.chip} gridTemplateColumns={GRID_COLUMNS} meta={child.meta} name={child.name} pct={`${child.pct.toFixed(2)}%`} trailing={<span className={clsx(dataGridNumericCell, 'text-text-muted')}>—</span>} value={displayAmount(amountsHidden, formatCurrency(child.value))} onClick={child.onClick} />
}

export function AllocationMobileRows({ amountsHidden, hoveredKey, invertChange, open, rows, selectedKey, onRowClick }: Omit<AllocationTableProps, 'changeLabel' | 'onHover' | 'pctLabel'>) {
  return (
    <div className="lg:hidden">
      <div className="flex justify-between px-4 pb-2 pt-5 text-xs text-text-muted">
        <span>Asset class</span>
        <span>Value · Return</span>
      </div>
      {rows.map((row) => {
        const expanded = row.expandable && (open[row.key] ?? false)
        return (
          <div key={row.key}>
            <ClickableRow
              className={clsx('flex min-h-[52px] w-full items-center gap-2.5 border-t border-border px-4 py-1.5 text-left', (hoveredKey === row.key || selectedKey === row.key) && 'bg-raised')}
              onClick={() => onRowClick(row)}
              pressed={selectedKey === row.key}
            >
              {row.expandable ? <span aria-hidden className={clsx('text-[10px] leading-none text-text-muted transition-transform', expanded && 'rotate-90')}>▶</span> : <span aria-hidden className="w-2.5" />}
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text-1">{row.label}</span>
                <span className="block text-xs text-text-muted">{row.count} holdings · {row.pct.toFixed(1)}%</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm text-text-1">{displayAmount(amountsHidden, formatCurrency(row.value))}</span>
                <ChangeCell amountsHidden={amountsHidden} invert={invertChange} row={row} size="sm" />
              </span>
            </ClickableRow>
            {expanded ? row.children.map((child) => <AllocationMobileChildRow amountsHidden={amountsHidden} child={child} key={child.key} />) : null}
          </div>
        )
      })}
    </div>
  )
}

function AllocationMobileChildRow({ amountsHidden, child }: { amountsHidden: boolean; child: AllocationChild }) {
  return <MobileChildRow chip={child.chip} meta={child.meta} name={child.name} pct={`${child.pct.toFixed(2)}%`} trailing={<span className="block text-[11px] text-text-muted">—</span>} value={displayAmount(amountsHidden, formatCurrency(child.value))} onClick={child.onClick} />
}
