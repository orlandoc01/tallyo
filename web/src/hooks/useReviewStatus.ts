import { useQuery } from 'urql'
import { needsConnectionReview } from '../components/institutions/connectionReview'
import { ASSETS_QUERY, BALANCE_REVIEWS_QUERY, TRANSACTIONS_QUERY } from '../graphql/queries'
import type { AssetList, BalanceSnapshotReviewList, TransactionConnection, TransactionsInput } from '../types/graphql'
import { useConnections } from './useEntityQueries'

const unreviewedTransactionsInput = {
  filter: { isReviewed: false },
  first: 1,
} satisfies TransactionsInput

type ReviewStatusOptions = {
  accounts?: boolean
  assets?: boolean
  balances?: boolean
  transactions?: boolean
}

export function useReviewStatus(options: boolean | ReviewStatusOptions = true) {
  const enabled = typeof options === 'boolean'
    ? { accounts: options, assets: options, balances: options, transactions: options }
    : { accounts: options.accounts ?? false, assets: options.assets ?? false, balances: options.balances ?? false, transactions: options.transactions ?? false }
  const [{ data: assetData }] = useQuery<{ assets: AssetList }>({
    query: ASSETS_QUERY,
    variables: { input: {} },
    pause: !enabled.assets,
  })
  const [{ data: balanceData }] = useQuery<{ balanceSnapshotReviews: BalanceSnapshotReviewList }>({
    query: BALANCE_REVIEWS_QUERY,
    pause: !enabled.balances,
  })
  const [{ data: transactionData }] = useQuery<{ transactions: TransactionConnection }, { input: TransactionsInput }>({
    query: TRANSACTIONS_QUERY,
    variables: { input: unreviewedTransactionsInput },
    pause: !enabled.transactions,
  })
  const { items: connections } = useConnections(true, !enabled.accounts)

  const counts = {
    assets: enabled.assets ? (assetData?.assets.items ?? []).filter((asset) => asset.priceConnectivity === 'NOT_FOUND' || asset.investmentConnectivity === 'NOT_FOUND').length : 0,
    balances: enabled.balances ? (balanceData?.balanceSnapshotReviews.items.length ?? 0) : 0,
    connections: enabled.accounts ? connections.filter(needsConnectionReview).length : 0,
    transactions: enabled.transactions ? (transactionData?.transactions.totalCount ?? 0) : 0,
  }

  return {
    counts,
    hasReviewItems: Object.values(counts).some((count) => count > 0),
  }
}
