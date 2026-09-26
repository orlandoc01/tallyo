import { ArrowUpDown } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useSortedTransactions } from '../../hooks/useTransactions'
import type { Category, TransactionsFilter, TransactionSort } from '../../types/graphql'
import { Button } from '../common/Button'
import { PickerSheet } from '../common/PickerSheet'
import { SORT_OPTIONS, sortFromId, sortId, type SortId } from '../transactions/transactionFilterPresets'
import { TransactionList } from '../transactions/TransactionList'
import { SORT_LABELS, nextSort } from './reportsSort'

const SORT_PICKER_OPTIONS = SORT_OPTIONS.map((option) => ({ id: option.id, label: SORT_LABELS[option.id] }))

export function ReportsTransactionList({ categories, onCategoryUpdated, sort, onSortChange, transactionFilter }: {
  categories: Category[]
  onCategoryUpdated: () => void
  sort: TransactionSort
  onSortChange: (sort: TransactionSort) => void
  transactionFilter: TransactionsFilter
}) {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [sortOpen, setSortOpen] = useState(false)
  const transactions = useSortedTransactions(transactionFilter, sort, 25)
  const sortButton = (
    <Button aria-label={`Sort: ${SORT_LABELS[sortId(sort)]}`} onClick={() => (isMobile ? setSortOpen(true) : onSortChange(nextSort(sort)))} variant="secondary">
      {SORT_LABELS[sortId(sort)]}
      <ArrowUpDown aria-hidden className="h-3.5 w-3.5" />
    </Button>
  )
  return (
    <>
      <TransactionList
        categories={categories}
        headerActions={sortButton}
        onCategoryUpdated={onCategoryUpdated}
        onDetailsOpen={(transaction) => navigate(`/transactions/${transaction.id}`)}
        reexecuteQuery={transactions.reexecuteQuery}
        sort={sort}
        transactions={transactions.transactions}
      />
      {sortOpen ? <PickerSheet<SortId> onChange={(id) => onSortChange(sortFromId(id))} onClose={() => setSortOpen(false)} options={SORT_PICKER_OPTIONS} title="Sort" value={sortId(sort)} /> : null}
    </>
  )
}
