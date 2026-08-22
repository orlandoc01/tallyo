import { TRANSACTIONS_SUMMARY_QUERY } from '../graphql/queries'
import type { TransactionsFilter, TransactionsSummary } from '../types/graphql'
import { useEntityQuery } from './useListQuery'

export function useTransactionsSummary(filter?: TransactionsFilter) {
  const { data: summary, ...result } = useEntityQuery<TransactionsSummary, { filter?: TransactionsFilter }>({ query: TRANSACTIONS_SUMMARY_QUERY, variables: { filter } }, 'transactionsSummary')
  return { ...result, summary: summary ?? null }
}
