import { useMemo, useState } from 'react'
import { useQuery } from 'urql'
import { TRANSACTIONS_QUERY } from '../graphql/queries'
import type { Transaction, TransactionConnection, TransactionsFilter, TransactionSort } from '../types/graphql'
import { localDateKeyFromDatetime } from '../utils/dates'

type TransactionQueryVariables = {
  input: {
    after?: string | null
    filter?: TransactionsFilter
    first: number
    sort: TransactionSort
  }
}

export function useSortedTransactions(filter: TransactionsFilter | undefined, sort: TransactionSort, first = 50, after?: string | null, search?: string) {
  const { connection, reexecuteQuery, result, transactions } = useTransactionsQuery(filter, sort, first, after, search)

  return {
    ...result,
    transactions,
    connection,
    reexecuteQuery,
  }
}

export function usePaginatedTransactions(
  filter: TransactionsFilter | undefined,
  sort: TransactionSort,
  pageSize = 50,
  search?: string,
) {
  const filterSortKey = JSON.stringify({ filter, search: search?.trim() ?? '', sort })
  const [filterKey, setFilterKey] = useState(filterSortKey)
  const [after, setAfter] = useState<string | null>(null)

  // Reset when filter/sort/search changes (React-approved derived-state pattern)
  if (filterSortKey !== filterKey) {
    setFilterKey(filterSortKey)
    setAfter(null)
  }

  const { connection, reexecuteQuery: reexecuteUrql, result, transactions } = useTransactionsQuery(filter, sort, pageSize, after, search)
  const pageInfo = connection?.pageInfo

  function loadMore() {
    if (!result.fetching && pageInfo?.hasNextPage && pageInfo.endCursor) {
      setAfter(pageInfo.endCursor)
    }
  }

  function reexecuteQuery(opts?: { requestPolicy?: 'network-only' | 'cache-and-network' | 'cache-first' }) {
    setAfter(null)
    reexecuteUrql({ requestPolicy: opts?.requestPolicy ?? 'network-only' })
  }

  return {
    fetching: result.fetching,
    transactions,
    hasNextPage: pageInfo?.hasNextPage ?? false,
    totalCount: connection?.totalCount,
    loadMore,
    reexecuteQuery,
  }
}

function useTransactionsQuery(filter: TransactionsFilter | undefined, sort: TransactionSort, first: number, after?: string | null, search?: string) {
  const queryFilter = useMemo(() => filterWithSearch(filter, search), [filter, search])
  const [result, reexecuteQuery] = useQuery<{ transactions: TransactionConnection }, TransactionQueryVariables>({
    query: TRANSACTIONS_QUERY,
    variables: { input: { filter: queryFilter, sort, first, after } },
  })
  const connection = result.data?.transactions
  const transactions = useMemo(() => connection?.edges.map((edge) => edge.node) ?? [], [connection?.edges])

  return { connection, reexecuteQuery, result, transactions }
}

function filterWithSearch(filter: TransactionsFilter | undefined, search?: string): TransactionsFilter | undefined {
  const trimmed = search?.trim()
  if (!trimmed) return filter
  return { ...filter, search: trimmed }
}

export function groupTransactionsByDate(transactions: Transaction[]) {
  const groups: Record<string, Transaction[]> = {}
  for (const transaction of transactions) {
    const dateKey = localDateKeyFromDatetime(transaction.datetime)
    ;(groups[dateKey] ??= []).push(transaction)
  }
  return groups
}
