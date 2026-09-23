import clsx from 'clsx'
import { ArrowUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../common/Button'
import { Donut } from '../common/Donut'
import { EmptyState } from '../common/EmptyState'
import { Card } from '../common/FormControls'
import { AllocationMobileRows, AllocationTable } from './AllocationTable'
import { assetAllocationRows, liabilityAllocationRows, sortAllocationRows, type AllocationRow, type SortDirection } from './allocationRows'
import { displayAmount } from './amountDisplay'
import { rangeOption } from './netWorthRanges'
import { useBreakdownSelection } from './useBreakdownSelection'
import { formatCurrencyAbbrev } from '../../utils/currency'
import { changeOverRange } from '../../utils/netWorth'
import type { AssetClassifier, HistoricalNetWorthReport, HoldingRollup, NetWorthRange, NetWorthReport } from '../../types/graphql'

export type FocusState = 'loading' | 'error' | 'ready'
export type BreakdownView = 'ASSETS' | 'LIABILITIES'

const FOCUS_BANNER_TEXT: Record<FocusState, string> = {
  loading: 'Loading breakdown as of',
  error: 'Could not load the breakdown as of',
  ready: 'Breakdown as of',
}

const VIEWS: Array<{ id: BreakdownView; label: string }> = [
  { id: 'ASSETS', label: 'Assets' },
  { id: 'LIABILITIES', label: 'Liabilities' },
]

interface AllocationCardProps {
  amountsHidden: boolean
  canReadHoldings?: boolean
  focusDate?: string
  focusState?: FocusState
  historicalReport?: HistoricalNetWorthReport
  range: NetWorthRange
  report: NetWorthReport
  selectedClassifier: AssetClassifier | null
  selectedLiabilityCategory: string | null
  view: BreakdownView
  onAssetClick: (holding: HoldingRollup) => void
  onClearFocus?: () => void
  onRetryFocus?: () => void
  onSelectClassifier: (classifier: AssetClassifier | null) => void
  onSelectLiabilityCategory: (category: string | null) => void
  onViewChange: (view: BreakdownView) => void
}

export function AllocationCard(props: AllocationCardProps) {
  const { focusDate, focusState = 'ready', view, onClearFocus, onRetryFocus, onSelectClassifier, onSelectLiabilityCategory, onViewChange } = props
  const [sort, setSort] = useState<SortDirection>('desc')

  function switchView(next: BreakdownView) {
    onViewChange(next)
    onSelectClassifier(null)
    onSelectLiabilityCategory(null)
  }

  return (
    <Card className="px-0 pb-1 pt-4 lg:px-6 lg:pb-2 lg:pt-5" data-net-worth-breakdown>
      <div aria-label="Asset breakdown view" className="flex items-center gap-3 px-4 lg:px-0" role="radiogroup">
        {VIEWS.map((option) => (
          <button
            aria-checked={view === option.id}
            className={clsx('text-[17px] font-semibold tracking-[-0.2px] transition-colors lg:text-lg', view === option.id ? 'text-text-1' : 'text-text-faint hover:text-text-2')}
            key={option.id}
            onClick={() => switchView(option.id)}
            role="radio"
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      {focusDate ? (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-md bg-raised px-3 py-2 text-[13px] text-text-2 lg:mx-0" role={focusState === 'error' ? 'alert' : undefined}>
          <span>{FOCUS_BANNER_TEXT[focusState]} <span className="font-medium text-text-1">{focusDate}</span></span>
          <span className="flex shrink-0 gap-1">
            {focusState === 'error' ? <Button onClick={onRetryFocus} size="sm" variant="ghost">Retry</Button> : null}
            <Button onClick={onClearFocus} size="sm" variant="ghost">Show current</Button>
          </span>
        </div>
      ) : null}
      <div className="mt-4 hidden justify-end lg:flex">
        <Button onClick={() => setSort((current) => (current === 'desc' ? 'asc' : 'desc'))} size="sm" variant="secondary">
          {sort === 'desc' ? 'Weight H → L' : 'Weight L → H'}
          <ArrowUpDown aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </div>
      <AllocationBody key={view} {...props} sort={sort} />
    </Card>
  )
}

function AllocationBody({ amountsHidden, canReadHoldings = true, historicalReport, range, report, selectedClassifier, selectedLiabilityCategory, sort, view, onAssetClick, onSelectClassifier, onSelectLiabilityCategory }: AllocationCardProps & { sort: SortDirection }) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const { handleClassifierClick, handleLiabilityClick, open, toggleOpen } = useBreakdownSelection({ onSelectClassifier, onSelectLiabilityCategory, selectedClassifier, selectedLiabilityCategory })
  const liabilities = view === 'LIABILITIES'
  const rows = useMemo(() => {
    const unsorted = liabilities
      ? liabilityAllocationRows(report.liabilityBreakdown, changeOverRange((historicalReport?.liabilitySeries ?? []).map((point) => ({ label: point.category, date: point.date, valueUSD: Math.abs(point.valueUSD) }))))
      : assetAllocationRows(report.classifierBreakdown, changeOverRange((historicalReport?.classifierSeries ?? []).map((point) => ({ label: point.classifier, date: point.date, valueUSD: point.valueUSD }))), canReadHoldings, onAssetClick)
    return sortAllocationRows(unsorted, sort)
  }, [canReadHoldings, historicalReport, liabilities, report, sort, onAssetClick])
  const selectedKey = liabilities ? selectedLiabilityCategory : selectedClassifier
  const total = liabilities ? report.currentLiabilitiesUSD : report.currentAssetsUSD

  if (rows.length === 0) return <div className="mx-4 mt-5 lg:mx-0"><EmptyState title={liabilities ? 'No liabilities yet' : 'No assets yet'} /></div>

  function selectRow(row: AllocationRow) {
    if (row.kind === 'asset') handleClassifierClick(row.key)
    else handleLiabilityClick(row.key)
    if (row.expandable) toggleOpen(row.key)
    setHoveredKey(null)
  }

  return (
    <>
      <div className="relative mx-auto mt-5 w-[200px] lg:w-full lg:max-w-[260px]">
        <Donut ariaLabel={liabilities ? 'Liabilities by category' : 'Assets by class'} hoveredKey={hoveredKey} onHover={setHoveredKey} onSelect={(key) => { const row = rows.find((item) => item.key === key); if (row) selectRow(row) }} selectedKey={selectedKey} slices={rows} />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[13px] text-text-muted">{liabilities ? 'All Liabilities' : 'Assets'}</span>
          <span className="text-[22px] font-semibold tracking-[-0.5px] text-text-1">{displayAmount(amountsHidden, formatCurrencyAbbrev(total, 1))}</span>
        </div>
      </div>
      <AllocationTable
        amountsHidden={amountsHidden}
        changeLabel={rangeOption(range).compact}
        hoveredKey={hoveredKey}
        invertChange={liabilities}
        open={open}
        pctLabel={liabilities ? '% of Liabilities' : '% of Assets'}
        rows={rows}
        selectedKey={selectedKey}
        onHover={setHoveredKey}
        onRowClick={selectRow}
      />
      <AllocationMobileRows amountsHidden={amountsHidden} hoveredKey={hoveredKey} invertChange={liabilities} open={open} rows={rows} selectedKey={selectedKey} onRowClick={selectRow} />
    </>
  )
}
