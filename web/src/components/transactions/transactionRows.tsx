import type { ComponentType } from 'react'
import type { Category, Transaction } from '../../types/graphql'
import type { TransactionRowProps } from './TransactionRow'

export interface TransactionRowContext {
  categories?: Category[]
  isBulkMode: boolean
  onCategoryChange?: (transaction: Transaction, category: Category) => void
  onDetailsOpen: (transaction: Transaction) => void
  selectedIds?: Set<string>
  toggleSelected?: (id: string) => void
  updatingCategoryIds: Set<string>
}

export function renderTransactionRows(transactions: Transaction[], ctx: TransactionRowContext, Row: ComponentType<TransactionRowProps>, showDate = false) {
  return transactions.map((transaction) => (
    <Row
      categories={ctx.categories}
      isBulkMode={ctx.isBulkMode}
      isSelected={ctx.selectedIds?.has(transaction.id) ?? false}
      isUpdatingCategory={ctx.updatingCategoryIds.has(transaction.id)}
      key={transaction.id}
      onCategoryChange={ctx.onCategoryChange}
      onDetailsOpen={ctx.onDetailsOpen}
      onToggleSelect={ctx.toggleSelected}
      showDate={showDate}
      transaction={transaction}
    />
  ))
}

export function dayTotal(transactions: Transaction[]) {
  return transactions.reduce((total, transaction) => total + transaction.amount, 0)
}
