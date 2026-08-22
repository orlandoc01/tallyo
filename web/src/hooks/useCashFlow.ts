import { CASH_FLOW_QUERY } from '../graphql/queries'
import type { CashFlowPeriod, SpendingFilter } from '../types/graphql'
import { emptyList, useEntityQuery } from './useListQuery'

export function useCashFlow(filter: SpendingFilter) {
  const { data, ...result } = useEntityQuery<{ periods: CashFlowPeriod[] }, { filter: SpendingFilter }>({ query: CASH_FLOW_QUERY, variables: { filter } }, 'cashFlow')
  return { ...result, periods: data?.periods ?? emptyList<CashFlowPeriod>() }
}
