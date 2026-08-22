import { OneLevelGroup, OneLevelGroupRow } from '../common/OneLevelGroup'
import { AssetBreakdownViewToggle } from './AssetBreakdownViewToggle'
import { displayAmount } from './amountDisplay'
import { useBreakdownSelection } from './useBreakdownSelection'
import { formatCurrency, formatSignedCurrency } from '../../utils/currency'
import { formatQuantity } from '../../utils/amount'
import { accountBalanceUSD } from '../../utils/accounts'
import type { Asset, AssetClassifier, ClassifierBreakdown, HoldingRollup, LiabilityBreakdown } from '../../types/graphql'

interface AssetClassTableProps {
  breakdown: ClassifierBreakdown[]
  liabilityBreakdown: LiabilityBreakdown[]
  selectedClassifier?: AssetClassifier | null
  selectedLiabilityCategory?: string | null
  view: 'ASSETS' | 'LIABILITIES'
  onAssetClick?: (holding: HoldingRollup) => void
  onSelectClassifier?: (classifier: AssetClassifier | null) => void
  onSelectLiabilityCategory?: (category: string | null) => void
  onViewChange?: (view: 'ASSETS' | 'LIABILITIES') => void
  amountsHidden?: boolean
  canReadHoldings?: boolean
}

export function AssetClassTable({ breakdown, liabilityBreakdown, selectedClassifier, selectedLiabilityCategory, view, onAssetClick, onSelectClassifier, onSelectLiabilityCategory, onViewChange, amountsHidden = false, canReadHoldings = true }: AssetClassTableProps) {
  const showLiabilities = view === 'LIABILITIES'
  const { handleClassifierClick, handleLiabilityClick, open, toggleOpen } = useBreakdownSelection({
    onSelectClassifier,
    onSelectLiabilityCategory,
    selectedClassifier,
    selectedLiabilityCategory,
  })

  const shouldShowQuantity = (assetType: Asset['assetType']) => assetType !== 'CURRENCY' && assetType !== 'REAL_ESTATE'

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-neutral-500">Detailed</h2>
        <div className="flex items-center gap-2">
          <AssetBreakdownViewToggle onViewChange={onViewChange} view={view} />
        </div>
      </div>

      {showLiabilities ? (
        <div className="space-y-3 p-4">
          {liabilityBreakdown.map((item) => {
            const expanded = open[item.category] ?? false
            const canExpand = item.accounts.length > 0
            return (
              <OneLevelGroup
                expanded={expanded}
                expandable={canExpand}
                expandButtonLabel={`${expanded ? 'Collapse' : 'Expand'} ${item.label} liabilities`}
                header={(
                  <>
                    <div>
                      <p className="font-semibold text-neutral-950">{item.label}</p>
                      <p className="text-xs text-neutral-500">{item.accountCount > 0 ? `${item.accountCount} accounts` : 'Manual debt'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-neutral-950">{displayAmount(amountsHidden, formatSignedCurrency(-item.valueUSD))}</p>
                      <p className="text-xs text-neutral-500">{item.percentOfLiabilities.toFixed(1)}%</p>
                    </div>
                  </>
                )}
                headerActive={selectedLiabilityCategory === item.category}
                key={item.category}
                onHeaderClick={onSelectLiabilityCategory ? () => handleLiabilityClick(item.category) : undefined}
                onToggle={() => toggleOpen(item.category)}
              >
                {item.accounts.map((account) => (
                  <OneLevelGroupRow key={account.id}>
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-neutral-900 dark:text-neutral-100" title={account.name}>{account.name}</p>
                        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400" title={account.owner.name}>{account.owner.name}</p>
                      </div>
                      <p className="shrink-0 font-semibold text-neutral-950 dark:text-neutral-100">{displayAmount(amountsHidden, formatSignedCurrency(-(accountBalanceUSD(account) ?? 0)))}</p>
                    </div>
                  </OneLevelGroupRow>
                ))}
              </OneLevelGroup>
            )
          })}
        </div>
      ) : (
        <div className="space-y-3 p-4">
          {breakdown.map((item) => {
            const expanded = open[item.classifier] ?? false
            return (
              <OneLevelGroup
                expandable={canReadHoldings}
                expanded={expanded}
                expandButtonLabel={`${expanded ? 'Collapse' : 'Expand'} ${item.label} holdings`}
                header={(
                  <>
                    <div>
                      <p className="font-semibold text-neutral-950">{item.label}</p>
                      <p className="text-xs text-neutral-500">{item.assetCount} holdings</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-neutral-950">{displayAmount(amountsHidden, formatCurrency(item.valueUSD))}</p>
                      <p className="text-xs text-neutral-500">{item.percentOfAssets.toFixed(1)}%</p>
                    </div>
                  </>
                )}
                headerActive={selectedClassifier === item.classifier}
                key={item.classifier}
                onHeaderClick={onSelectClassifier ? () => handleClassifierClick(item.classifier) : undefined}
                onToggle={() => toggleOpen(item.classifier)}
              >
                {item.holdings.map((holding) => (
                  <OneLevelGroupRow
                    ariaLabel={`Edit ${holding.asset.name ?? holding.asset.identifier}`}
                    key={holding.asset.id}
                    onClick={onAssetClick ? () => onAssetClick(holding) : undefined}
                  >
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0 text-neutral-700 dark:text-neutral-300">
                        <p className="truncate font-semibold" title={holding.asset.name ?? holding.asset.identifier}>{holding.asset.name ?? holding.asset.identifier}</p>
                        {shouldShowQuantity(holding.asset.assetType) && holding.totalQuantity != null ? <p className="text-xs text-neutral-500 dark:text-neutral-400">Qty {formatQuantity(holding.totalQuantity)}</p> : null}
                      </div>
                      <p className="shrink-0 font-semibold text-neutral-950 dark:text-neutral-100">{displayAmount(amountsHidden, formatCurrency(holding.valueUSD))}</p>
                    </div>
                  </OneLevelGroupRow>
                ))}
              </OneLevelGroup>
            )
          })}
        </div>
      )}
    </section>
  )
}
