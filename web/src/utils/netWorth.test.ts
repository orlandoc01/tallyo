import { describe, expect, it } from 'vitest'
import { changeOverRange, netWorthChangeOverRange } from './netWorth'
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

describe('changeOverRange', () => {
  it('diffs the last and first point of each labelled series', () => {
    const changes = changeOverRange([
      { label: 'PUBLIC', date: '2026-03-01', valueUSD: 150 },
      { label: 'CASH', date: '2026-01-01', valueUSD: 100 },
      { label: 'PUBLIC', date: '2026-01-01', valueUSD: 200 },
      { label: 'CASH', date: '2026-03-01', valueUSD: 125 },
    ])

    expect(changes.get('CASH')).toEqual({ changeUSD: 25, changePct: 25 })
    expect(changes.get('PUBLIC')).toEqual({ changeUSD: -50, changePct: -25 })
    expect(changes.get('CRYPTOCURRENCY')).toBeUndefined()
  })

  it('reports a zero percentage when the series starts at zero', () => {
    expect(changeOverRange([{ label: 'CASH', date: '2026-01-01', valueUSD: 0 }, { label: 'CASH', date: '2026-02-01', valueUSD: 10 }]).get('CASH')).toEqual({ changeUSD: 10, changePct: 0 })
  })
})
