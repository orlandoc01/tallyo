import { describe, expect, it } from 'vitest'
import { stubClassifierBreakdown, stubNetWorthAssetsUSD } from './netWorthFixtures'

describe('stubClassifierBreakdown', () => {
  it('gives every classifier five distinct accounts with consistent totals', () => {
    const breakdown = stubClassifierBreakdown(true)
    expect(breakdown.map((group) => group.classifier)).toEqual(['CASH', 'PUBLIC', 'COMPANY_EQUITY', 'CRYPTOCURRENCY', 'STABLECOIN', 'REAL_ESTATE'])
    for (const group of breakdown) {
      const accountIds = new Set(group.holdings.flatMap((rollup) => rollup.holdings?.map((holding) => holding.account.id) ?? []))
      expect(accountIds.size, group.classifier).toBe(5)
      expect(group.holdings.reduce((sum, rollup) => sum + rollup.valueUSD, 0)).toBe(group.valueUSD)
    }
    expect(breakdown.reduce((sum, group) => sum + group.valueUSD, 0)).toBe(stubNetWorthAssetsUSD)
    expect(breakdown.reduce((sum, group) => sum + group.percentOfAssets, 0)).toBeCloseTo(100, 1)
    expect(stubClassifierBreakdown(false)[0].holdings[0].holdings).toBeNull()
  })
})
