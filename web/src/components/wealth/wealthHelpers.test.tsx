import { describe, expect, it, vi } from 'vitest'
import type { Account, Asset, ClassifierBreakdown } from '../../types/graphql'
import { accountSyncStatus } from './accountSidebarGroups'
import { assetAllocationRows } from './allocationRows'
import { chartDateTick } from '../../utils/dates'

const now = new Date('2026-09-20T12:00:00Z').getTime()

function account(overrides: Partial<Account>): Account {
  return { id: 'acc', name: 'Checking', type: 'DEPOSITORY', owner: { id: 'owner', name: 'Alex' }, closed: false, hidden: false, needsReview: false, manual: false, typeLocked: false, createdAt: '', updatedAt: '', ...overrides }
}

describe('accountSyncStatus', () => {
  it('flags active accounts synced more than 30 days ago without a reconnect hint', () => {
    expect(accountSyncStatus(account({ lastSyncedAt: '2026-07-01T00:00:00Z', connection: { id: 'c', name: 'Chase', owner: { id: 'owner', name: 'Alex' }, isActive: true, provider: null } }), now)).toEqual({ text: '3mo ago', stale: true })
    expect(accountSyncStatus(account({ lastSyncedAt: '2026-09-19T12:00:00Z' }), now)).toEqual({ text: '1d ago', stale: false })
  })

  it('asks to reconnect inactive connections even without a sync time', () => {
    expect(accountSyncStatus(account({ connection: { id: 'c', name: 'Chase', owner: { id: 'owner', name: 'Alex' }, isActive: false, provider: null } }), now)).toEqual({ text: 'not synced · Reconnect', stale: true })
    expect(accountSyncStatus(account({}), now)).toBeNull()
  })
})

describe('assetAllocationRows', () => {
  const lpAsset: Asset = { id: 'lp', assetType: 'CRYPTO', identifier: 'LP', name: 'Aero LP', classifier: 'CRYPTOCURRENCY', trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [] }
  const breakdown: ClassifierBreakdown[] = [{
    classifier: 'CRYPTOCURRENCY',
    label: 'Cryptocurrency',
    valueUSD: 300,
    percentOfAssets: 100,
    assetCount: 2,
    holdings: [
      { asset: { id: 'eth', assetType: 'CRYPTO', identifier: 'ETH', name: null, classifier: 'CRYPTOCURRENCY', trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [] }, totalQuantity: 2.5, valueUSD: 200, percentOfClassifier: 66.67, holdings: [] },
      { asset: lpAsset, totalQuantity: null, valueUSD: 100, percentOfClassifier: 33.33, holdings: [{ assetId: 'lp', asset: lpAsset, accountId: 'w1', account: account({ id: 'w1' }), quantity: null, valueUSD: 50, manual: false }, { assetId: 'lp', asset: lpAsset, accountId: 'w2', account: account({ id: 'w2' }), quantity: null, valueUSD: 50, manual: false }] },
    ],
  }]

  it('describes holdings by units or by account count', () => {
    const [row] = assetAllocationRows(breakdown, new Map(), true, vi.fn())
    expect(row.expandable).toBe(true)
    expect(row.children.map((child) => [child.name, child.meta])).toEqual([['ETH', '2.5 units'], ['Aero LP', '2 accounts']])
  })

  it('is not expandable without holdings access', () => {
    const [row] = assetAllocationRows(breakdown, new Map(), false, vi.fn())
    expect(row.expandable).toBe(false)
    expect(row.children).toEqual([])
  })
})

describe('chartDateTick', () => {
  it('formats month labels and marks the as-of point as Today', () => {
    expect(chartDateTick('2026-03-01', { compact: false, lastDate: '2026-05-01', asOfDate: '2026-05-01' })).toBe('Mar 2026')
    expect(chartDateTick('2026-03-01', { compact: true, lastDate: '2026-05-01', asOfDate: '2026-05-01' })).toBe('Mar')
    expect(chartDateTick('2026-05-01', { compact: false, lastDate: '2026-05-01', asOfDate: '2026-05-01' })).toBe('Today')
    expect(chartDateTick('2026-05-01', { compact: false, lastDate: '2026-05-01', asOfDate: '2026-05-21' })).toBe('May 2026')
  })
})
