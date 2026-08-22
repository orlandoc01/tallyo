import { useCallback, useState } from 'react'
import { useClient, useMutation } from 'urql'
import { BULK_DELETE_TRANSACTIONS_MUTATION, BULK_UPDATE_TRANSACTIONS_MUTATION } from '../../graphql/mutations'
import { TRANSACTION_IDS_QUERY } from '../../graphql/queries'
import type { TransactionSort, TransactionUpdates, TransactionsFilter, TransactionsInput } from '../../types/graphql'
import { useTransactionSelection } from './useTransactionSelection'

const TRANSACTION_IDS_PAGE_SIZE = 1000

type TransactionIdsQueryData = {
  transactions: {
    edges: Array<{ node: { id: string } }>
    pageInfo: { hasNextPage: boolean; endCursor?: string | null }
    totalCount: number
  }
}

// Bulk-mode state and actions for the transactions page: select-all across
// every ID page of the current filter, the edit/delete confirmation modals,
// and their mutations. `filter` must include the free-text search so the
// selection matches what the list and summary show.
export function useBulkTransactionActions({
  filter,
  sort,
  refetch,
}: {
  filter: TransactionsFilter
  sort: TransactionSort
  refetch: () => void
}) {
  const client = useClient()
  const { clearSelection, exitBulkMode, selectAll, selectedIds } = useTransactionSelection()
  const [, bulkUpdateTransactions] = useMutation(BULK_UPDATE_TRANSACTIONS_MUTATION)
  const [, bulkDeleteTransactions] = useMutation(BULK_DELETE_TRANSACTIONS_MUTATION)

  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkEditError, setBulkEditError] = useState<string | null>(null)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)
  const [bulkSelectError, setBulkSelectError] = useState<string | null>(null)
  const [bulkEditSubmitting, setBulkEditSubmitting] = useState(false)
  const [bulkDeleteSubmitting, setBulkDeleteSubmitting] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)

  const cancelBulkMode = useCallback(() => {
    setShowBulkEdit(false)
    setShowBulkDelete(false)
    setBulkEditError(null)
    setBulkDeleteError(null)
    setBulkSelectError(null)
    exitBulkMode()
  }, [exitBulkMode])

  async function selectAllInFilter() {
    if (selectingAll) return

    setSelectingAll(true)
    setBulkSelectError(null)
    const ids: string[] = []
    let after: string | null = null

    try {
      for (;;) {
        const input: TransactionsInput = { filter, sort, first: TRANSACTION_IDS_PAGE_SIZE, after }
        const result = await client.query<TransactionIdsQueryData, { input: TransactionsInput }>(TRANSACTION_IDS_QUERY, { input }, { requestPolicy: 'network-only' }).toPromise()
        if (result.error) throw result.error

        const page = result.data?.transactions
        if (!page) throw new Error('No transaction data returned.')

        ids.push(...page.edges.map((edge) => edge.node.id))
        if (!page.pageInfo.hasNextPage) break
        if (!page.pageInfo.endCursor) throw new Error('No cursor returned for the next page.')
        after = page.pageInfo.endCursor
      }

      selectAll(ids)
    } catch (error) {
      clearSelection()
      setBulkSelectError(error instanceof Error ? error.message : 'Could not select transactions.')
    } finally {
      setSelectingAll(false)
    }
  }

  function toggleSelectAll() {
    if (selectedIds.size === 0) {
      void selectAllInFilter()
    } else {
      setBulkSelectError(null)
      clearSelection()
    }
  }

  async function confirmBulkUpdate(updates: TransactionUpdates) {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setBulkEditSubmitting(true)
    setBulkEditError(null)
    const result = await bulkUpdateTransactions({ input: { transactionIds: ids, updates } })
    setBulkEditSubmitting(false)

    if (result.error) {
      setBulkEditError(result.error.message)
      return
    }

    setShowBulkEdit(false)
    exitBulkMode()
    refetch()
  }

  async function confirmBulkDelete() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setBulkDeleteSubmitting(true)
    setBulkDeleteError(null)
    const result = await bulkDeleteTransactions({ input: { transactionIds: ids } })
    setBulkDeleteSubmitting(false)

    if (result.error) {
      setBulkDeleteError(result.error.message)
      return
    }

    setShowBulkDelete(false)
    exitBulkMode()
    refetch()
  }

  return {
    bulkDeleteError,
    bulkDeleteSubmitting,
    bulkEditError,
    bulkEditSubmitting,
    bulkSelectError,
    cancelBulkMode,
    closeBulkDelete: () => { setShowBulkDelete(false); setBulkDeleteError(null) },
    closeBulkEdit: () => { setShowBulkEdit(false); setBulkEditError(null) },
    confirmBulkDelete,
    confirmBulkUpdate,
    openBulkDelete: () => setShowBulkDelete(true),
    openBulkEdit: () => setShowBulkEdit(true),
    selectingAll,
    showBulkDelete,
    showBulkEdit,
    toggleSelectAll,
  }
}
