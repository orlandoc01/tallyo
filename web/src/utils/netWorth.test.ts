import { describe, expect, it } from 'vitest'
import { netWorthChangeOverRange } from './netWorth'
import type { NetWorthPoint } from '../types/graphql'

function point(netWorthUSD: number): NetWorthPoint {
  return { date: '2026-06-01', totalAssetsUSD: netWorthUSD, totalLiabilitiesUSD: 0, netWorthUSD }
}

describe('netWorthChangeOverRange', () => {
  it('returns a zero change when there is no series', () => {
    expect(netWorthChangeOverRange(1000)).toEqual({ changeUSD: 0, changePct: 0 })
    expect(netWorthChangeOverRange(1000, [])).toEqual({ changeUSD: 0, changePct: 0 })
  })

  it('computes a positive gain from the first series point', () => {
    expect(netWorthChangeOverRange(1000, [point(800), point(1000)])).toEqual({ changeUSD: 200, changePct: 25 })
  })

  it('computes a negative loss from the first series point', () => {
    expect(netWorthChangeOverRange(1000, [point(1250), point(1000)])).toEqual({ changeUSD: -250, changePct: -20 })
  })

  it('uses the magnitude of the start value so negative net worth stays meaningful', () => {
    expect(netWorthChangeOverRange(-50, [point(-100)])).toEqual({ changeUSD: 50, changePct: 50 })
  })

  it('avoids dividing by zero when the range starts at zero', () => {
    expect(netWorthChangeOverRange(500, [point(0)])).toEqual({ changeUSD: 500, changePct: 0 })
  })
})
