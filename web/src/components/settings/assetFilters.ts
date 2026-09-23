import type { AssetType } from '../../types/graphql'

export type AssetTypeFilter = AssetType | 'ALL'

export const ASSET_TYPE_OPTIONS: Array<{ label: string; value: AssetTypeFilter }> = [
  { label: 'All', value: 'ALL' },
  { label: 'Currency', value: 'CURRENCY' },
  { label: 'Security', value: 'SECURITY' },
  { label: 'Crypto', value: 'CRYPTO' },
  { label: 'Real estate', value: 'REAL_ESTATE' },
  { label: 'Other', value: 'OTHER' },
]

export interface AssetFilterValues {
  assetType: AssetTypeFilter
  includeHistorical: boolean
}

export const emptyAssetFilters: AssetFilterValues = { assetType: 'ALL', includeHistorical: false }

export function countActiveAssetFilters(filters: AssetFilterValues) {
  return (filters.assetType === 'ALL' ? 0 : 1) + (filters.includeHistorical ? 1 : 0)
}

export function assetTypeLabel(assetType: AssetTypeFilter) {
  return ASSET_TYPE_OPTIONS.find((option) => option.value === assetType)?.label ?? 'All'
}
