import type { ClassifierBreakdown, HoldingRollup } from '../../types/graphql'
import { formatQuantity } from '../../utils/amount'
import { assetClassColors } from '../../utils/chartStyles'
import { formatCurrency } from '../../utils/currency'
import { Button } from '../common/Button'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetHero } from '../common/SheetHero'
import { SheetStaticRow } from '../common/SheetRows'
import { TickerChip } from '../common/Tag'

function holdingMeta(holding: HoldingRollup) {
  const quantityApplies = holding.asset.assetType !== 'CURRENCY' && holding.asset.assetType !== 'REAL_ESTATE'
  if (quantityApplies && holding.totalQuantity != null) return `${formatQuantity(holding.totalQuantity)} ${holding.asset.assetType === 'SECURITY' ? 'shares' : 'units'}`
  const accounts = holding.holdings?.length ?? 0
  return `${accounts} ${accounts === 1 ? 'position' : 'positions'}`
}

// Read-mostly: assets have no per-holding return, price refresh or
// auto-update setting in the API, so those rows are omitted; "Edit asset"
// opens the existing asset editor.
export function HoldingDetailSheet({ classifier, holding, onClose, onEditAsset, onViewAccount, totalAssetsUSD }: {
  classifier: ClassifierBreakdown | null
  holding: HoldingRollup
  onClose: () => void
  onEditAsset: (holding: HoldingRollup) => void
  onViewAccount?: (holding: HoldingRollup) => void
  totalAssetsUSD: number
}) {
  const accounts = holding.holdings?.map((item) => item.account) ?? []
  const name = holding.asset.name ?? holding.asset.identifier
  const weight = totalAssetsUSD === 0 ? '—' : `${((holding.valueUSD / totalAssetsUSD) * 100).toFixed(2)}% of assets`
  return (
    <MobileSheet
      action={<Button className="touch-manipulation" onClick={() => onEditAsset(holding)} size="sm" variant="ghost">Edit asset</Button>}
      bodyClassName="pb-2"
      footer={<MobileFilterFooter primaryLabel="Done" secondaryLabel="View account" secondaryVariant="outline-accent" onPrimary={onClose} onSecondary={onViewAccount && accounts.length > 0 ? () => onViewAccount(holding) : undefined} />}
      hideClose
      labelledBy="holding-detail-title"
      maxHeight="84%"
      onClose={onClose}
      title="Holding"
    >
      <div aria-label={`Details for ${name}`} role="region">
        <SheetHero
          avatar={<TickerChip size="md">{holding.asset.assetType === 'REAL_ESTATE' ? 'RE' : holding.asset.identifier}</TickerChip>}
          sub={[accounts[0]?.name, holdingMeta(holding)].filter(Boolean).join(' · ')}
          title={name}
          value={formatCurrency(holding.valueUSD)}
        />
        <SheetStaticRow
          label="Asset class"
          value={classifier ? (
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="h-5 w-5 shrink-0 rounded-full" style={{ backgroundColor: assetClassColors[classifier.classifier] }} />
              {classifier.label}
            </span>
          ) : '—'}
        />
        <SheetStaticRow label="Weight" value={weight} />
        <SheetStaticRow label="Source" value={accounts.length ? accounts.map((account) => account.connection?.name ?? account.name).join(', ') : '—'} />
      </div>
    </MobileSheet>
  )
}
