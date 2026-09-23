import { DataGridChildRow, MobileChildRow } from '../common/DataGrid'
import { displayAmount } from '../wealth/amountDisplay'
import { CLASSIFIER_LABELS } from '../wealth/assetFormOptions'
import type { AnalysisHolding, Asset } from '../../types/graphql'
import { formatCurrency } from '../../utils/currency'

export const HOLDING_GRID_COLUMNS = 'minmax(150px,1fr) minmax(70px,120px) minmax(100px,160px)'

export function AnalysisHoldingRow({ holding, amountsHidden, variant, onEditAsset }: { holding: AnalysisHolding; amountsHidden: boolean; variant: 'desktop' | 'mobile'; onEditAsset: (asset: Asset) => void }) {
  const name = holding.asset.name ?? holding.asset.identifier
  const props = {
    chip: holding.asset.assetType === 'REAL_ESTATE' ? 'RE' : holding.asset.identifier,
    name,
    meta: CLASSIFIER_LABELS[holding.asset.classifier],
    pct: `${holding.percent.toFixed(1)}%`,
    value: displayAmount(amountsHidden, formatCurrency(holding.valueUSD)),
    onClick: () => onEditAsset(holding.asset),
  }
  return variant === 'desktop' ? <DataGridChildRow {...props} gridTemplateColumns={HOLDING_GRID_COLUMNS} /> : <MobileChildRow {...props} />
}
