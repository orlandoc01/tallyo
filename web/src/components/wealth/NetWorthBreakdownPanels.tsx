import type { AssetClassifier, HoldingRollup, NetWorthReport } from '../../types/graphql'
import { AssetClassTable } from './AssetClassTable'
import { AssetsDonut } from './AssetsDonut'

export type FocusState = 'loading' | 'error' | 'ready'

const FOCUS_BANNER_TEXT: Record<FocusState, string> = {
  loading: 'Loading breakdown as of',
  error: 'Could not load the breakdown as of',
  ready: 'Breakdown as of',
}

// The assets donut + class table pair, rendered twice by the net worth page:
// side by side on desktop and stacked (with an expandable legend) on mobile.
// Selection state is lifted to the page so both variants stay in sync.
export function NetWorthBreakdownPanels({
  amountsHidden,
  canReadHoldings = true,
  focusDate,
  focusState = 'ready',
  report,
  selectedClassifier,
  selectedLiabilityCategory,
  variant,
  view,
  onAssetClick,
  onClearFocus,
  onRetryFocus,
  onSelectClassifier,
  onSelectLiabilityCategory,
  onViewChange,
}: {
  amountsHidden: boolean
  canReadHoldings?: boolean
  focusDate?: string
  focusState?: FocusState
  report: NetWorthReport
  selectedClassifier: AssetClassifier | null
  selectedLiabilityCategory: string | null
  variant: 'desktop' | 'mobile'
  view: 'ASSETS' | 'LIABILITIES'
  onAssetClick: (holding: HoldingRollup) => void
  onClearFocus?: () => void
  onRetryFocus?: () => void
  onSelectClassifier: (classifier: AssetClassifier | null) => void
  onSelectLiabilityCategory: (category: string | null) => void
  onViewChange: (view: 'ASSETS' | 'LIABILITIES') => void
}) {
  const donut = (
    <AssetsDonut
      amountsHidden={amountsHidden}
      breakdown={report.classifierBreakdown}
      canReadHoldings={canReadHoldings}
      expandableLegend={variant === 'mobile'}
      liabilityBreakdown={report.liabilityBreakdown}
      onSelectClassifier={onSelectClassifier}
      onSelectLiabilityCategory={onSelectLiabilityCategory}
      selectedClassifier={selectedClassifier}
      selectedLiabilityCategory={selectedLiabilityCategory}
      totalAssets={report.currentAssetsUSD}
      totalLiabilities={report.currentLiabilitiesUSD}
      view={view}
      onViewChange={onViewChange}
    />
  )
  const table = (
    <AssetClassTable
      amountsHidden={amountsHidden}
      breakdown={report.classifierBreakdown}
      canReadHoldings={canReadHoldings}
      liabilityBreakdown={report.liabilityBreakdown}
      onAssetClick={onAssetClick}
      onSelectClassifier={onSelectClassifier}
      onSelectLiabilityCategory={onSelectLiabilityCategory}
      selectedClassifier={selectedClassifier}
      selectedLiabilityCategory={selectedLiabilityCategory}
      view={view}
      onViewChange={onViewChange}
    />
  )

  const focusBanner = focusDate ? (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2 text-sm ${focusState === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
      data-net-worth-breakdown
      role={focusState === 'error' ? 'alert' : undefined}
    >
      <span>{FOCUS_BANNER_TEXT[focusState]} <span className="font-semibold">{focusDate}</span></span>
      <span className="flex shrink-0 gap-3">
        {focusState === 'error' ? <button className="font-medium underline-offset-2 hover:underline" onClick={onRetryFocus} type="button">Retry</button> : null}
        <button className="font-medium underline-offset-2 hover:underline" onClick={onClearFocus} type="button">Show current</button>
      </span>
    </div>
  ) : null

  if (variant === 'desktop') {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {focusBanner ? <div className="lg:col-span-2">{focusBanner}</div> : null}
        <div className="min-w-0" data-net-worth-breakdown>{donut}</div>
        <div className="min-w-0" data-net-worth-breakdown>{table}</div>
      </div>
    )
  }

  return (
    <>
      {focusBanner ? <div className="lg:hidden">{focusBanner}</div> : null}
      <div className="lg:hidden" data-net-worth-breakdown>{donut}</div>
      <div className="lg:hidden" data-net-worth-breakdown>{table}</div>
    </>
  )
}
