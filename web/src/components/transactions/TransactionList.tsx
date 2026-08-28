import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation } from 'urql'
import { Card } from '../common/FormControls'
import { Modal } from '../common/Modal'
import { UPDATE_TRANSACTION_MUTATION } from '../../graphql/mutations'
import type { Category, Transaction, TransactionSort } from '../../types/graphql'
import { formatDisplayDate } from '../../utils/dates'
import { formatSignedCurrency } from '../../utils/currency'
import { groupTransactionsByDate } from '../../hooks/useTransactions'
import { usePermissions } from '../../hooks/usePermissions'
import { TransactionDetailsPane } from './TransactionDetailsPane'
import { MobileTransactionRow, TransactionRow } from './TransactionRow'
import { MobileDateGroup } from './MobileTransactionList'
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
    if (onDetailsOpen) {
      onDetailsOpen(transaction)
    } else {
      setSelectedId(transaction.id)
    }
  }

  function closeDetails() {
    if (onDetailsClose) {
      onDetailsClose()
    } else {
      setSelectedId(null)
    }
  }

  function updateRenderedTransaction(transaction: Transaction) {
    setUpdatedTransactions((items) => {
      const nextItems = new Map(items)
      nextItems.set(transaction.id, transaction)
      return nextItems
    })
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
    if (!el) return
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

  const showPane = !!(selectedTransaction && categories)

  const paneKey = selectedTransaction?.id
  const detailsPaneProps = showPane
    ? {
        categories,
        onClose: closeDetails,
        onDelete: (id: string) => {
          setDeletedIds((ids) => new Set(ids).add(id))
          closeDetails()
        },
        onUpdate: updateRenderedTransaction,
        transaction: selectedTransaction,
      }
    : null

  return (
    <div>
      <Card>
        {/* Desktop table view */}
        <div className="hidden lg:block">
          <div className="flex items-center justify-end gap-4 border-b border-neutral-100 p-5">
            {showTitle ? <h2 className="mr-auto text-xl font-bold">Transactions</h2> : null}
            <div className="flex items-center gap-3">
              {headerActions}
              {onSortChange ? (
                <label className="flex items-center gap-2 text-sm text-neutral-500">
                  Sort
                  <TransactionSortSelect onSortChange={onSortChange} sort={sort} />
                </label>
              ) : null}
            </div>
          </div>
          <div className="overflow-x-auto">
            {isEmpty ? (
              emptyState ? <div className="p-5">{emptyState}</div> : null
            ) : (
              <table className="w-full min-w-[760px] border-collapse">
                <tbody>
                    {isAmountSort
                      ? renderTransactionRows(displayedTransactions, rowContext, TransactionRow, true)
                      : Object.entries(groups).map(([date, dateTransactions]) => (
                          <DateGroup ctx={rowContext} date={date} key={date} transactions={dateTransactions} />
                        ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Mobile list view */}
        <div className="lg:hidden">
          {onSortChange ? (
            <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
              {showTitle ? <h2 className="text-lg font-bold">Transactions</h2> : null}
              <div className="flex items-center gap-2">
                {headerActions}
                <TransactionSortSelect ariaLabel="Sort" onSortChange={onSortChange} sort={sort} />
              </div>
            </div>
          ) : null}
          {isEmpty
            ? emptyState ? <div className="p-4">{emptyState}</div> : null
            : isAmountSort
              ? renderTransactionRows(displayedTransactions, rowContext, MobileTransactionRow, true)
              : Object.entries(groups).map(([date, dateTransactions]) => (
                  <MobileDateGroup ctx={rowContext} date={date} key={date} transactions={dateTransactions} />
                ))}
        </div>

        <div ref={sentinelRef} className="h-1" />
        {hasNextPage ? (
          <div className="flex justify-center py-3 text-sm text-neutral-400">Loading more…</div>
        ) : null}
      </Card>

      {detailsPaneProps ? (
        <Modal label={`Details for ${selectedTransaction?.merchantName || selectedTransaction?.originalName || 'transaction'}`} onClose={closeDetails} scrollable size="lg">
          <TransactionDetailsPane key={paneKey} {...detailsPaneProps} />
        </Modal>
      ) : null}
    </div>
  )
}

function DateGroup({
  ctx,
  date,
  transactions,
}: {
  ctx: TransactionRowContext
  date: string
  transactions: Transaction[]
}) {
  return (
    <Fragment>
      <tr className="bg-neutral-100 text-sm font-semibold text-neutral-500">
        {ctx.isBulkMode ? <td className="w-10 px-2 py-0" /> : null}
        <td className="px-4 py-2" colSpan={4}>{formatDisplayDate(date)}</td>
        <td className="px-4 py-2 text-right tabular-nums">{formatSignedCurrency(dayTotal(transactions))}</td>
      </tr>
      {renderTransactionRows(transactions, ctx, TransactionRow)}
    </Fragment>
  )
}
