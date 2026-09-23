import clsx from 'clsx'
import { ClickableRow } from '../common/ClickableRow'
import { DataGridHeader, DataGridRow, ExpandGlyph, dataGridNumericCell, dataGridTextCell } from '../common/DataGrid'
import { displayAmount } from '../wealth/amountDisplay'
import type { AnalysisSlice, Asset } from '../../types/graphql'
import { formatCurrency } from '../../utils/currency'
import { AnalysisHoldingRow, HOLDING_GRID_COLUMNS } from './AnalysisHoldingRow'
import { UNCLASSIFIED_LABEL, analysisSliceColor } from './analysisSliceColor'
import { UNCLASSIFIED_NOTE } from './portfolioSlices'

export interface PortfolioTableProps {
  amountsHidden: boolean
  hoveredLabel: string | null
  modeLabel: string
  open: Record<string, boolean>
  selectedLabel: string | null
  slices: AnalysisSlice[]
  onEditAsset: (asset: Asset) => void
  onHover: (label: string | null) => void
  onRowClick: (slice: AnalysisSlice) => void
}

function rowState(slice: AnalysisSlice, index: number, open: Record<string, boolean>) {
  const expandable = slice.holdings.length > 0
  return {
    expandable,
    expanded: expandable && (open[slice.label] ?? false),
    unclassified: slice.label === UNCLASSIFIED_LABEL,
    color: analysisSliceColor(slice.label, index),
  }
}

export function PortfolioTable({ amountsHidden, hoveredLabel, modeLabel, open, selectedLabel, slices, onEditAsset, onHover, onRowClick }: PortfolioTableProps) {
  return (
    <div className="-mx-6 mt-6 hidden overflow-x-auto px-6 lg:block">
      <div className="min-w-[420px]">
        <DataGridHeader gridTemplateColumns={HOLDING_GRID_COLUMNS}>
          <span>{modeLabel}</span>
          <span className={dataGridNumericCell}>Weight</span>
          <span className={dataGridNumericCell}>Value</span>
        </DataGridHeader>
        {slices.map((slice, index) => {
          const { expandable, expanded, unclassified, color } = rowState(slice, index, open)
          return (
            <div key={slice.label}>
              <DataGridRow expanded={expandable ? expanded : undefined} gridTemplateColumns={HOLDING_GRID_COLUMNS} highlighted={hoveredLabel === slice.label || selectedLabel === slice.label} onClick={() => onRowClick(slice)} onHoverChange={(hovered) => onHover(hovered ? slice.label : null)} pressed={selectedLabel === slice.label}>
                <span className={clsx(dataGridTextCell, 'flex items-center font-medium text-text-1')}>
                  <ExpandGlyph color={color} dashed={unclassified} expandable={expandable} open={expanded} />
                  <span className="truncate">{slice.label}</span>
                  {unclassified ? <span className="ml-2 truncate font-normal text-text-muted">{UNCLASSIFIED_NOTE}</span> : null}
                </span>
                <span className={clsx(dataGridNumericCell, 'font-medium text-text-1')}>{slice.percent.toFixed(1)}%</span>
                <span className={clsx(dataGridNumericCell, 'text-text-3')}>{displayAmount(amountsHidden, formatCurrency(slice.valueUSD))}</span>
              </DataGridRow>
              {expanded ? slice.holdings.map((holding) => <AnalysisHoldingRow amountsHidden={amountsHidden} holding={holding} key={holding.asset.id} variant="desktop" onEditAsset={onEditAsset} />) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PortfolioMobileRows({ amountsHidden, hoveredLabel, modeLabel, open, selectedLabel, slices, onEditAsset, onRowClick }: Omit<PortfolioTableProps, 'onHover'>) {
  return (
    <div className="lg:hidden">
      <div className="flex justify-between px-4 pb-2 pt-5 text-xs text-text-muted">
        <span>{modeLabel}</span>
        <span>Weight · Value</span>
      </div>
      {slices.map((slice, index) => {
        const { expandable, expanded, unclassified, color } = rowState(slice, index, open)
        return (
          <div key={slice.label}>
            <ClickableRow
              expanded={expandable ? expanded : undefined}
              className={clsx('flex min-h-[48px] w-full items-center gap-2.5 border-t border-border px-4 py-1 text-left', unclassified && 'border-dashed', (hoveredLabel === slice.label || selectedLabel === slice.label) && 'bg-raised')}
              onClick={() => onRowClick(slice)}
              pressed={selectedLabel === slice.label}
            >
              <span aria-hidden className={clsx('h-2 w-2 shrink-0 rounded-full', unclassified && 'border border-dashed')} style={unclassified ? { borderColor: color } : { backgroundColor: color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text-1">{slice.label}</span>
                {unclassified ? <span className="block truncate text-xs text-text-muted">{UNCLASSIFIED_NOTE}</span> : null}
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-medium text-text-1">{slice.percent.toFixed(1)}%</span>
                <span className="block text-xs text-text-muted">{displayAmount(amountsHidden, formatCurrency(slice.valueUSD))}</span>
              </span>
            </ClickableRow>
            {expanded ? slice.holdings.map((holding) => <AnalysisHoldingRow amountsHidden={amountsHidden} holding={holding} key={holding.asset.id} variant="mobile" onEditAsset={onEditAsset} />) : null}
          </div>
        )
      })}
    </div>
  )
}
