import { Eye, EyeOff } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { useFilterCaretRight } from '../../hooks/useFilterCaretRight'
import type { Account, AnalysisReport, AnalysisSlice, Asset, Owner } from '../../types/graphql'
import { formatCurrency, formatCurrencyAbbrev } from '../../utils/currency'
import { IconButton } from '../common/Button'
import { Donut } from '../common/Donut'
import { FilterPanel } from '../common/FilterPanel'
import { FiltersButton } from '../common/FiltersButton'
import { Card } from '../common/FormControls'
import { SegmentedControl } from '../common/SegmentedControl'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { displayAmount } from '../wealth/amountDisplay'
import { AccountChip, AccountTypeChip, OwnerChip } from '../wealth/WealthFilterChips'
import { PORTFOLIO_VIEW_OPTIONS, donutSlices, portfolioFilterCount, portfolioViewOption, type PortfolioFilters, type PortfolioViewParam } from './portfolioSlices'
import { PortfolioMobileRows, PortfolioTable } from './PortfolioTable'

export function PortfolioCard({ accounts, amountsHidden, body, fetching, filters, owners, report, selectedLabel, view, onEditAsset, onFilterChange, onClearFilters, onSelectLabel, onToggleAmountsHidden, onViewChange }: {
  accounts: Account[]
  amountsHidden: boolean
  body: ReactNode
  fetching: boolean
  filters: PortfolioFilters
  owners: Owner[]
  report: AnalysisReport | undefined
  selectedLabel: string | null
  view: PortfolioViewParam
  onEditAsset: (asset: Asset) => void
  onFilterChange: (patch: Partial<PortfolioFilters>) => void
  onClearFilters: () => void
  onSelectLabel: (label: string | null) => void
  onToggleAmountsHidden: () => void
  onViewChange: (view: PortfolioViewParam) => void
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const filtersButtonRef = useRef<HTMLButtonElement>(null)
  const caretRight = useFilterCaretRight(filtersOpen, filtersButtonRef, cardRef)
  const filterCount = portfolioFilterCount(filters)
  const modeLabel = portfolioViewOption(view).label
  const current = fetching ? undefined : report
  const VisibilityIcon = amountsHidden ? EyeOff : Eye

  return (
    <Card className="px-0 pb-1 pt-4 lg:px-6 lg:pb-2 lg:pt-5" overflow="visible">
      <div ref={cardRef}>
        <div className="flex items-start justify-between gap-3 px-4 lg:px-0">
          <div className="min-w-0">
            <p className="text-[13px] text-text-muted">Total analyzed</p>
            {current ? (
              <>
                <p className="mt-0.5 truncate text-[22px] font-semibold leading-7 tracking-[-0.3px] text-text-1">{displayAmount(amountsHidden, formatCurrency(current.totalValueUSD))}</p>
                <p className="mt-0.5 text-xs text-text-muted lg:text-[13px]">{sliceSummary(current.slices.length)} across {modeLabel}</p>
              </>
            ) : (
              <>
                <p className="mt-0.5 text-[22px] font-semibold leading-7 text-text-muted"><span aria-hidden>—</span><span className="sr-only">Total analyzed unavailable</span></p>
                <p className="mt-0.5 text-xs text-text-muted lg:text-[13px]">{modeLabel}</p>
              </>
            )}
          </div>
          <div className="hidden shrink-0 items-center gap-2 lg:flex">
            <SegmentedControl ariaLabel="Analysis view" onChange={onViewChange} options={PORTFOLIO_VIEW_OPTIONS} value={view} />
            <IconButton ariaLabel={amountsHidden ? 'Show amounts' : 'Hide amounts'} onClick={onToggleAmountsHidden} pressed={amountsHidden}>
              <VisibilityIcon className="h-4 w-4" />
            </IconButton>
            <FiltersButton count={filterCount} onClick={() => setFiltersOpen((current) => !current)} open={filtersOpen} ref={filtersButtonRef} />
          </div>
        </div>
        {filtersOpen ? (
          <div className="hidden lg:block">
            <FilterPanel
              actions={(
                <label className="mr-1 flex items-center gap-2 text-[13px] text-text-3">
                  <ToggleSwitch checked={filters.includeUnclassified} label="Include unclassified" onChange={(includeUnclassified) => onFilterChange({ includeUnclassified })} />
                  Include unclassified
                </label>
              )}
              caretRight={caretRight}
              clearable={filterCount > 0}
              onClear={onClearFilters}
              variant="inset-2"
            >
              <OwnerChip accounts={accounts} ownerIds={filters.ownerIds} owners={owners} onChange={(ownerIds) => onFilterChange({ ownerIds })} />
              <AccountTypeChip accountGroupIds={filters.accountGroupIds} accounts={accounts} onChange={(accountGroupIds) => onFilterChange({ accountGroupIds })} />
              <AccountChip accountIds={filters.accountIds} accounts={accounts} onChange={(accountIds) => onFilterChange({ accountIds })} />
            </FilterPanel>
          </div>
        ) : null}
      </div>
      <div className="mt-3.5 px-4 lg:hidden">
        <SegmentedControl ariaLabel="Analysis view" fullWidth onChange={onViewChange} options={PORTFOLIO_VIEW_OPTIONS} value={view} />
      </div>
      {current && current.slices.length > 0 ? (
        <PortfolioBreakdown key={view} amountsHidden={amountsHidden} modeLabel={modeLabel} report={current} selectedLabel={selectedLabel} onEditAsset={onEditAsset} onSelectLabel={onSelectLabel} />
      ) : (
        <div className="mx-4 mt-5 lg:mx-0">{body}</div>
      )}
    </Card>
  )
}

function sliceSummary(count: number) {
  return `${count} ${count === 1 ? 'slice' : 'slices'}`
}

function PortfolioBreakdown({ amountsHidden, modeLabel, report, selectedLabel, onEditAsset, onSelectLabel }: {
  amountsHidden: boolean
  modeLabel: string
  report: AnalysisReport
  selectedLabel: string | null
  onEditAsset: (asset: Asset) => void
  onSelectLabel: (label: string | null) => void
}) {
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  function selectSlice(slice: AnalysisSlice) {
    const nextSelected = selectedLabel === slice.label ? null : slice.label
    onSelectLabel(nextSelected)
    if (slice.holdings.length) setOpen((current) => ({ ...current, [slice.label]: nextSelected !== null }))
    setHoveredLabel(null)
  }

  const rowProps = { amountsHidden, hoveredLabel, modeLabel, open, selectedLabel, slices: report.slices, onEditAsset, onRowClick: selectSlice }

  return (
    <>
      <div className="relative mx-auto mt-5 w-[200px] lg:w-full lg:max-w-[260px]">
        <Donut ariaLabel={`Portfolio by ${modeLabel.toLowerCase()}`} hoveredKey={hoveredLabel} onHover={setHoveredLabel} onSelect={(key) => { const slice = report.slices.find((item) => item.label === key); if (slice) selectSlice(slice) }} selectedKey={selectedLabel} slices={donutSlices(report.slices, report.totalValueUSD)} />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] uppercase tracking-[2px] text-text-muted">Total</span>
          <span className="text-2xl font-semibold tracking-[-0.5px] text-text-1 lg:text-[26px]">{displayAmount(amountsHidden, formatCurrencyAbbrev(report.totalValueUSD, 1))}</span>
        </div>
      </div>
      <PortfolioTable {...rowProps} onHover={setHoveredLabel} />
      <PortfolioMobileRows {...rowProps} />
    </>
  )
}
