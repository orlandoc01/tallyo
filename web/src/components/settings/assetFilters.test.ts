import { describe, expect, it } from 'vitest'
import { assetTypeLabel, countActiveAssetFilters, emptyAssetFilters } from './assetFilters'

describe('assetFilters', () => {
  it('counts only non-default filters', () => {
    expect(countActiveAssetFilters(emptyAssetFilters)).toBe(0)
    expect(countActiveAssetFilters({ assetType: 'CRYPTO', includeHistorical: false })).toBe(1)
    expect(countActiveAssetFilters({ assetType: 'CRYPTO', includeHistorical: true })).toBe(2)
  })

  it('labels asset types', () => {
    expect(assetTypeLabel('ALL')).toBe('All')
    expect(assetTypeLabel('REAL_ESTATE')).toBe('Real estate')
  })
})
