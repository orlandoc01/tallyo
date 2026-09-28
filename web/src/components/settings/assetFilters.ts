import type { AssetType } from '../../types/graphql'
import { ASSET_TYPE_LABELS } from '../wealth/assetFormOptions'

export type AssetTypeFilter = AssetType | 'ALL'

export const ASSET_TYPE_FILTER_OPTIONS: Array<{ label: string; value: AssetTypeFilter }> = [
  { label: 'All', value: 'ALL' },
  ...(Object.entries(ASSET_TYPE_LABELS) as Array<[AssetType, string]>).map(([value, label]) => ({ label, value })),
]

export function assetTypeLabel(assetType: AssetTypeFilter) {
  return assetType === 'ALL' ? 'All' : ASSET_TYPE_LABELS[assetType]
}

export interface AssetFilterValues {
  assetType: AssetTypeFilter
  includeHistorical: boolean
}

export const emptyAssetFilters: AssetFilterValues = { assetType: 'ALL', includeHistorical: false }

export function countActiveAssetFilters(filters: AssetFilterValues) {
  return (filters.assetType === 'ALL' ? 0 : 1) + (filters.includeHistorical ? 1 : 0)
}
