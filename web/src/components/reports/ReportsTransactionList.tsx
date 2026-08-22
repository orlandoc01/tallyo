import { useSortedTransactions } from '../../hooks/useTransactions'
import type { Category, TransactionsFilter, TransactionSort } from '../../types/graphql'
import { TransactionList } from '../transactions/TransactionList'

export function ReportsTransactionList({
  categories,
  onCategoryUpdated,
  sort,
  onSortChange,
  transactionFilter,
}: {
  categories: Category[]
  onCategoryUpdated: () => void
  sort: TransactionSort
  onSortChange: (sort: TransactionSort) => void
  transactionFilter: TransactionsFilter
}) {
  const transactions = useSortedTransactions(transactionFilter, sort, 25)
  return (
    <TransactionList
      categories={categories}
      onCategoryUpdated={onCategoryUpdated}
      onSortChange={onSortChange}
      reexecuteQuery={transactions.reexecuteQuery}
      sort={sort}
      transactions={transactions.transactions}
    />
  )
}
