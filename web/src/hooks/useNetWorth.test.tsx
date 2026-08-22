import { renderHook, waitFor } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../mocks/server'
import { mockQuery } from '../test/msw'
import { createProvidersWrapper } from '../test/renderWithProviders'
import { useNetWorth } from './useNetWorth'

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
