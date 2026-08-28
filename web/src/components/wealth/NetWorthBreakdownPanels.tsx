import type { AssetClassifier, HoldingRollup, NetWorthReport } from '../../types/graphql'
import { AssetClassTable } from './AssetClassTable'
import { AssetsDonut } from './AssetsDonut'

// The assets donut + class table pair, rendered twice by the net worth page:
// side by side on desktop and stacked (with an expandable legend) on mobile.
// Selection state is lifted to the page so both variants stay in sync.
export function NetWorthBreakdownPanels({
  amountsHidden,
  canReadHoldings = true,
  report,
  selectedClassifier,
  selectedLiabilityCategory,
  variant,
  view,
  onAssetClick,
  onSelectClassifier,
  onSelectLiabilityCategory,
  onViewChange,
}: {
  amountsHidden: boolean
  canReadHoldings?: boolean
  report: NetWorthReport
  selectedClassifier: AssetClassifier | null
  selectedLiabilityCategory: string | null
  variant: 'desktop' | 'mobile'
  view: 'ASSETS' | 'LIABILITIES'
  onAssetClick: (holding: HoldingRollup) => void
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

  if (variant === 'desktop') {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0" data-net-worth-breakdown>{donut}</div>
        <div className="min-w-0" data-net-worth-breakdown>{table}</div>
      </div>
    )
  }

  return (
    <>
      <div className="lg:hidden" data-net-worth-breakdown>{donut}</div>
      <div className="lg:hidden" data-net-worth-breakdown>{table}</div>
    </>
  )
}
