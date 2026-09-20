import { renderHook, waitFor } from '@testing-library/react'
import { delay, graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { accounts, accountSnapshots } from '../mocks/fixtures'
import { server } from '../mocks/server'
import { mockQuery } from '../test/msw'
import { createProvidersWrapper } from '../test/renderWithProviders'
import type { NetWorthInput } from '../types/graphql'
import { useNetWorth } from './useNetWorth'

const wrapper = createProvidersWrapper({ withGraphql: true, auth: {} })

// Liability rows carry their own balance so a historical report never rewrites the cached Account.
function reportAsOf(asOfDate: string | null) {
  const card = { ...accounts[0], id: 'acct-card', name: 'Card', type: 'CREDIT', latestSnapshot: { ...accountSnapshots[0], id: 'snapshot-card', accountId: 'acct-card', balanceUSD: 80 } }
  const balanceUSD = asOfDate ? 50 : 80
  return {
    __typename: 'NetWorthReport',
    asOfDate,
    currentNetWorthUSD: 1000,
    currentAssetsUSD: asOfDate ? 900 : 1200,
    currentLiabilitiesUSD: balanceUSD,
    classifierBreakdown: [],
    liabilityBreakdown: [{ __typename: 'LiabilityBreakdown', category: 'CARD', label: 'Cards', valueUSD: balanceUSD, percentOfLiabilities: 100, accountCount: 1, balances: [{ __typename: 'LiabilityAccountBalance', account: card, balanceUSD }] }],
  }
}

function mockNetWorthByDate(delayMs = 0) {
  server.use(graphql.link('/query').query('NetWorth', async ({ variables }) => {
    const asOfDate = (variables.input as NetWorthInput).asOfDate ?? null
    if (asOfDate && delayMs) await delay(delayMs)
    return HttpResponse.json({ data: { netWorth: reportAsOf(asOfDate) } })
  }))
}

describe('useNetWorth', () => {
  it('returns the net worth report', async () => {
    mockQuery('NetWorth', {
      netWorth: {
        __typename: 'NetWorthReport',
        asOfDate: '2026-06-01',
        currentNetWorthUSD: 1000,
        currentAssetsUSD: 1200,
        currentLiabilitiesUSD: 200,
        classifierBreakdown: [],
        liabilityBreakdown: [],
      },
    })

    const { result } = renderHook(() => useNetWorth({}), { wrapper: createProvidersWrapper({ withGraphql: true, auth: {} }) })

    await waitFor(() => expect(result.current.fetching).toBe(false))
    expect(result.current.report?.currentNetWorthUSD).toBe(1000)
  })

  it('keeps the previous report while new variables load, flagged as fetching', async () => {
    mockNetWorthByDate(150)
    const { result, rerender } = renderHook(({ input }: { input: NetWorthInput }) => useNetWorth(input), { wrapper, initialProps: { input: {} } })
    await waitFor(() => expect(result.current.fetching).toBe(false))
    expect(result.current.report?.currentAssetsUSD).toBe(1200)

    rerender({ input: { asOfDate: '2026-07-01' } })

    await waitFor(() => expect(result.current.fetching).toBe(true))
    expect(result.current.report?.asOfDate).toBeNull()
    await waitFor(() => expect(result.current.fetching).toBe(false))
    expect(result.current.report?.asOfDate).toBe('2026-07-01')
    expect(result.current.report?.currentAssetsUSD).toBe(900)
  })

  it('caches live and dated reports side by side without rewriting the account', async () => {
    mockNetWorthByDate()
    const { result } = renderHook(() => ({ live: useNetWorth({}), focused: useNetWorth({ asOfDate: '2026-01-15' }) }), { wrapper })
    await waitFor(() => expect(result.current.live.fetching || result.current.focused.fetching).toBe(false))

    const liveBalance = result.current.live.report?.liabilityBreakdown[0].balances[0]
    const focusedBalance = result.current.focused.report?.liabilityBreakdown[0].balances[0]
    expect(liveBalance?.balanceUSD).toBe(80)
    expect(focusedBalance?.balanceUSD).toBe(50)
    expect(liveBalance?.account.latestSnapshot?.balanceUSD).toBe(80)
    expect(focusedBalance?.account.latestSnapshot?.balanceUSD).toBe(80)
  })

  it('does not request protected holding rows without read:holdings', async () => {
    let includeHoldings: boolean | undefined
    server.use(graphql.link('/query').query('NetWorth', ({ variables }) => {
      includeHoldings = variables.includeHoldings as boolean
      return HttpResponse.json({ data: { netWorth: { __typename: 'NetWorthReport', asOfDate: null, currentNetWorthUSD: 1000, currentAssetsUSD: 1000, currentLiabilitiesUSD: 0, classifierBreakdown: [], liabilityBreakdown: [] } } })
    }))

    const { result } = renderHook(() => useNetWorth({}), { wrapper: createProvidersWrapper({ withGraphql: true, auth: { scopes: ['read:wealth'] } }) })

    await waitFor(() => expect(result.current.fetching).toBe(false))
    expect(includeHoldings).toBe(false)
  })
})
