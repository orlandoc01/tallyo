import { ArrowUpDown } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useSortedTransactions } from '../../hooks/useTransactions'
import type { Category, TransactionsFilter, TransactionSort } from '../../types/graphql'
import { Button } from '../common/Button'
import { sortId } from '../transactions/transactionFilterPresets'
import { TransactionList } from '../transactions/TransactionList'
import { SORT_LABELS, nextSort } from './reportsSort'

export function ReportsTransactionList({ categories, onCategoryUpdated, sort, onSortChange, transactionFilter }: {
  categories: Category[]
  onCategoryUpdated: () => void
  sort: TransactionSort
  onSortChange: (sort: TransactionSort) => void
  transactionFilter: TransactionsFilter
}) {
  const navigate = useNavigate()
  const transactions = useSortedTransactions(transactionFilter, sort, 25)
  const sortButton = (
    <Button aria-label={`Sort: ${SORT_LABELS[sortId(sort)]}`} onClick={() => onSortChange(nextSort(sort))} variant="secondary">
      {SORT_LABELS[sortId(sort)]}
      <ArrowUpDown aria-hidden className="h-3.5 w-3.5" />
    </Button>
  )
  return (
    <TransactionList
      categories={categories}
      headerActions={sortButton}
      onCategoryUpdated={onCategoryUpdated}
      onDetailsOpen={(transaction) => navigate(`/transactions/${transaction.id}`)}
      reexecuteQuery={transactions.reexecuteQuery}
      sort={sort}
      transactions={transactions.transactions}
    />
  )
}
