import clsx from 'clsx'
import { useEffect, useId, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { useMutation } from 'urql'
import { Button } from '../common/Button'
import { Card } from '../common/FormControls'
import { UPDATE_TRANSACTION_MUTATION } from '../../graphql/mutations'
import type { Category, Transaction, TransactionSort } from '../../types/graphql'
import { groupTransactionsByDate } from '../../hooks/useTransactions'
import { formatSignedCurrency } from '../../utils/currency'
import { formatDisplayDate } from '../../utils/dates'
import { usePermissions } from '../../hooks/usePermissions'
import { TransactionDetailsOverlay } from './TransactionDetailsOverlay'
import { TransactionDetailsPane } from './TransactionDetailsPane'
import { MobileTransactionRow, TransactionRow, type TransactionRowProps } from './TransactionRow'
import { TransactionSortSelect } from './transactionRowGroups'
import { type TransactionRowContext, dayTotal, renderTransactionRows } from './transactionRows'

export function TransactionList({
  categories,
  emptyState,
  hasNextPage,
  isBulkMode = false,
  loadMore,
  headerActions,
  onCategoryUpdated,
  onDetailsClose,
  onDetailsOpen,
  onShowMerchant,
  onSortChange,
  selectedIds,
  selectedTransactionId,
  showTitle = true,
  sort,
  toggleSelected,
  transactions,
}: {
  categories?: Category[]
  emptyState?: ReactNode
  hasNextPage?: boolean
  headerActions?: ReactNode
  isBulkMode?: boolean
  loadMore?: () => void
  onCategoryUpdated?: () => void
  onDetailsClose?: () => void
  onDetailsOpen?: (transaction: Transaction) => void
  onShowMerchant?: (merchant: string) => void
  onSortChange?: (sort: TransactionSort) => void
  reexecuteQuery?: (opts?: { requestPolicy?: 'network-only' | 'cache-and-network' | 'cache-first' }) => void
  selectedIds?: Set<string>
  selectedTransactionId?: string
  showTitle?: boolean
  sort?: TransactionSort
  toggleSelected?: (id: string) => void
  transactions: Transaction[]
}) {
  const [, updateTransaction] = useMutation(UPDATE_TRANSACTION_MUTATION)
  const { canWrite } = usePermissions()
  const canWriteTransactions = canWrite('transactions')
  const detailsTitleId = useId()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set())
  const [updatedTransactions, setUpdatedTransactions] = useState<Map<string, Transaction>>(() => new Map())
  const [updatingCategoryIds, setUpdatingCategoryIds] = useState<Set<string>>(() => new Set())

  const isAmountSort = sort?.field === 'AMOUNT'
  const renderedTransactions = useMemo(
    () => transactions.map((transaction) => updatedTransactions.get(transaction.id) ?? transaction),
    [transactions, updatedTransactions],
  )
  const displayedTransactions = renderedTransactions.filter((transaction) => !deletedIds.has(transaction.id))
  const isEmpty = displayedTransactions.length === 0
  const groups = groupTransactionsByDate(displayedTransactions)

  const activeSelectedId = selectedTransactionId ?? selectedId
  const selectedTransaction = displayedTransactions.find((t) => t.id === activeSelectedId)

  function openDetails(transaction: Transaction) {
    if (onDetailsOpen) onDetailsOpen(transaction)
    else setSelectedId(transaction.id)
  }

  function closeDetails() {
    if (onDetailsClose) onDetailsClose()
    else setSelectedId(null)
  }

  function updateRenderedTransaction(transaction: Transaction) {
    setUpdatedTransactions((items) => new Map(items).set(transaction.id, transaction))
  }

  async function changeCategory(transaction: Transaction, category: Category) {
    setUpdatingCategoryIds((ids) => new Set(ids).add(transaction.id))
    const result = await updateTransaction({ input: { id: transaction.id, updates: { categoryId: category.id } } })
    setUpdatingCategoryIds((ids) => {
      const nextIds = new Set(ids)
      nextIds.delete(transaction.id)
      return nextIds
    })
    if (result.error) return
    const updatedTransaction = result.data?.updateTransaction?.transaction
    if (updatedTransaction) updateRenderedTransaction(updatedTransaction)
    onCategoryUpdated?.()
  }

  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!loadMore || !hasNextPage) return
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore() },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore, hasNextPage])

  const rowContext: TransactionRowContext = {
    categories: canWriteTransactions ? categories : undefined,
    isBulkMode,
    onCategoryChange: canWriteTransactions ? changeCategory : undefined,
    onDetailsOpen: openDetails,
    selectedIds,
    toggleSelected,
    updatingCategoryIds,
  }

  const showHeader = showTitle || Boolean(headerActions) || Boolean(onSortChange)
  const detailsPane = selectedTransaction && categories ? (
    <TransactionDetailsPane
      categories={categories}
      key={selectedTransaction.id}
      onClose={closeDetails}
      onDelete={(id: string) => {
        setDeletedIds((ids) => new Set(ids).add(id))
        closeDetails()
      }}
      onShowMerchant={onShowMerchant ? (merchant) => { onShowMerchant(merchant); closeDetails() } : undefined}
      onUpdate={updateRenderedTransaction}
      titleId={detailsTitleId}
      transaction={selectedTransaction}
    />
  ) : null
  const detailsLabel = `Details for ${selectedTransaction?.merchantName || selectedTransaction?.originalName || 'transaction'}`

  return (
    <div>
      <Card>
        <div className="hidden lg:block">
          {showHeader ? (
            <div className="flex items-center justify-end gap-4 border-b border-border px-5 py-3">
              {showTitle ? <h2 className="mr-auto text-base font-semibold tracking-[-0.2px] text-text-1">Transactions</h2> : null}
              <div className="flex items-center gap-3">
                {headerActions}
                {onSortChange ? (
                  <label className="flex items-center gap-2 text-xs text-text-muted">
                    Sort
                    <TransactionSortSelect onSortChange={onSortChange} sort={sort} />
                  </label>
                ) : null}
              </div>
            </div>
          ) : null}
          {isEmpty
            ? emptyState ? <div className="p-5">{emptyState}</div> : null
            : isAmountSort
              ? renderTransactionRows(displayedTransactions, rowContext, TransactionRow, true)
              : Object.entries(groups).map(([date, dateTransactions]) => (
                  <TransactionDateGroup ctx={rowContext} date={date} key={date} Row={TransactionRow} transactions={dateTransactions} />
                ))}
        </div>

        <div className="lg:hidden">
          {showHeader ? (
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              {showTitle ? <h2 className="text-[15px] font-semibold text-text-1">Transactions</h2> : null}
              <div className="flex items-center gap-2">
                {headerActions}
                {onSortChange ? <TransactionSortSelect ariaLabel="Sort" onSortChange={onSortChange} sort={sort} /> : null}
              </div>
            </div>
          ) : null}
          {isEmpty
            ? emptyState ? <div className="p-4">{emptyState}</div> : null
            : isAmountSort
              ? renderTransactionRows(displayedTransactions, rowContext, MobileTransactionRow, true)
              : Object.entries(groups).map(([date, dateTransactions]) => (
                  <TransactionDateGroup ctx={rowContext} date={date} key={date} mobile Row={MobileTransactionRow} transactions={dateTransactions} />
                ))}
        </div>

        <div ref={sentinelRef} className="h-px" />
        {hasNextPage && loadMore ? (
          <Button className="w-full" onClick={loadMore} size="lg" variant="ghost">Load more</Button>
        ) : null}
      </Card>

      {detailsPane ? (
        <TransactionDetailsOverlay label={detailsLabel} onClose={closeDetails} titleId={detailsTitleId}>
          {detailsPane}
        </TransactionDetailsOverlay>
      ) : null}
    </div>
  )
}

function TransactionDateGroup({ ctx, date, mobile = false, Row, transactions }: {
  ctx: TransactionRowContext
  date: string
  mobile?: boolean
  Row: ComponentType<TransactionRowProps>
  transactions: Transaction[]
}) {
  return (
    <>
      <div className={clsx('flex items-center justify-between border-b border-border bg-surface-2 text-xs font-medium text-text-muted', mobile ? 'px-4 py-[7px]' : 'px-5 py-2')} data-date-group>
        <span>{formatDisplayDate(date)}</span>
        <span className="tabular-nums">{formatSignedCurrency(dayTotal(transactions))}</span>
      </div>
      {renderTransactionRows(transactions, ctx, Row)}
    </>
  )
}
