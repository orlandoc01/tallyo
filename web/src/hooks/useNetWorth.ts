import { HISTORICAL_NET_WORTH_QUERY, NET_WORTH_QUERY } from '../graphql/queries'
import type { HistoricalNetWorthInput, HistoricalNetWorthReport, NetWorthInput, NetWorthReport } from '../types/graphql'
import { usePermissions } from './usePermissions'
import { useEntityQuery } from './useListQuery'

export function useNetWorth(input: NetWorthInput, pause = false) {
  const { canRead } = usePermissions()
  const includeHoldings = canRead('holdings')
  const { data: report, ...result } = useEntityQuery<NetWorthReport, { input: NetWorthInput; includeHoldings: boolean }>(
    { query: NET_WORTH_QUERY, variables: { input, includeHoldings }, pause },
    'netWorth',
  )
  return { ...result, report }
}

export function useHistoricalNetWorth(input: HistoricalNetWorthInput) {
  const { data: historicalReport, ...result } = useEntityQuery<HistoricalNetWorthReport, { input: HistoricalNetWorthInput }>({ query: HISTORICAL_NET_WORTH_QUERY, variables: { input } }, 'historicalNetWorth')
  return { ...result, historicalReport }
}
