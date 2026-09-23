import type { AssetClassifier, ClassifierBreakdown, HoldingRollup, LiabilityBreakdown, LiabilityCategory } from '../../types/graphql'
import { formatQuantity } from '../../utils/amount'
import { assetClassColors, liabilityColors } from '../../utils/chartStyles'
import type { NetWorthChange } from '../../utils/netWorth'

export interface AllocationChild {
  key: string
  chip: string
  name: string
  meta: string
  pct: number
  value: number
  onClick?: () => void
}

interface AllocationRowBase {
  label: string
  color: string
  value: number
  pct: number
  count: number
  change: NetWorthChange | null
  expandable: boolean
  children: AllocationChild[]
}

export type AllocationRow =
  | (AllocationRowBase & { kind: 'asset'; key: AssetClassifier })
  | (AllocationRowBase & { kind: 'liability'; key: LiabilityCategory })

export type SortDirection = 'desc' | 'asc'

const LIABILITY_CHIPS: Record<LiabilityCategory, string> = { MORTGAGE: 'MTG', CARD: 'CC', LOAN: 'LOAN', OTHER: 'OTH' }

function holdingMeta(holding: HoldingRollup) {
  const quantityApplies = holding.asset.assetType !== 'CURRENCY' && holding.asset.assetType !== 'REAL_ESTATE'
  if (quantityApplies && holding.totalQuantity != null) return `${formatQuantity(holding.totalQuantity)} ${holding.asset.assetType === 'SECURITY' ? 'shares' : 'units'}`
  const accounts = holding.holdings?.length ?? 0
  return `${accounts} ${accounts === 1 ? 'account' : 'accounts'}`
}

export function assetAllocationRows(breakdown: ClassifierBreakdown[], changes: Map<string, NetWorthChange>, expandable: boolean, onAssetClick: (holding: HoldingRollup) => void): AllocationRow[] {
  return breakdown.map((item) => ({
    kind: 'asset',
    key: item.classifier,
    label: item.label,
    color: assetClassColors[item.classifier],
    value: item.valueUSD,
    pct: item.percentOfAssets,
    count: item.assetCount,
    change: changes.get(item.classifier) ?? null,
    expandable: expandable && item.holdings.length > 0,
    children: expandable ? item.holdings.map((holding) => {
      const name = holding.asset.name ?? holding.asset.identifier
      return {
        key: holding.asset.id,
        chip: holding.asset.assetType === 'REAL_ESTATE' ? 'RE' : holding.asset.identifier,
        name,
        meta: holdingMeta(holding),
        pct: holding.percentOfClassifier,
        value: holding.valueUSD,
        onClick: () => onAssetClick(holding),
      }
    }) : [],
  }))
}

export function liabilityAllocationRows(liabilityBreakdown: LiabilityBreakdown[], changes: Map<string, NetWorthChange>): AllocationRow[] {
  const total = liabilityBreakdown.reduce((sum, item) => sum + item.valueUSD, 0)
  return liabilityBreakdown.map((item) => ({
    kind: 'liability',
    key: item.category,
    label: item.label,
    color: liabilityColors[item.category],
    value: item.valueUSD,
    pct: item.percentOfLiabilities,
    count: item.accountCount,
    change: changes.get(item.category) ?? null,
    expandable: item.balances.length > 0,
    children: item.balances.map(({ account, balanceUSD }) => ({
      key: account.id,
      chip: LIABILITY_CHIPS[item.category],
      name: account.name,
      meta: account.connection?.name ?? account.owner.name,
      pct: total === 0 ? 0 : (balanceUSD / total) * 100,
      value: balanceUSD,
    })),
  }))
}

export function sortAllocationRows(rows: AllocationRow[], direction: SortDirection): AllocationRow[] {
  return [...rows].sort((left, right) => direction === 'desc' ? right.value - left.value : left.value - right.value)
}
