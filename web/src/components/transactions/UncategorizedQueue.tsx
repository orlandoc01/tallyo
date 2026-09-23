import { useEffect, useId, useState } from 'react'
import { useMutation, useQuery } from 'urql'
import { BULK_UPDATE_TRANSACTIONS_MUTATION, REPROCESS_UNCATEGORIZED_MUTATION, UPDATE_TRANSACTION_MUTATION } from '../../graphql/mutations'
import { CONFIGURATION_QUERY, TRANSACTIONS_QUERY, TRANSACTIONS_STAGED_FOR_CATEGORIZATION_QUERY } from '../../graphql/queries'
import { useCategories } from '../../hooks/useEntityQueries'
import { usePermissions } from '../../hooks/usePermissions'
import type { Transaction, TransactionConnection, TransactionsInput, TransactionsStagedForCategorization } from '../../types/graphql'
import { UNCATEGORIZED_CATEGORY_ID } from '../../utils/categoryTint'
import { Button } from '../common/Button'
import { EmptyState } from '../common/EmptyState'
import { Card, FormError, FormSuccess } from '../common/FormControls'
import { QueryGate } from '../common/QueryGate'
import { TransactionDetailsOverlay } from './TransactionDetailsOverlay'
import { TransactionDetailsPane } from './TransactionDetailsPane'
import { MobileTransactionRow, TransactionRow } from './TransactionRow'

const PAGE_SIZE = 50

function isApprovable(transaction: Transaction) {
  return transaction.category.id !== UNCATEGORIZED_CATEGORY_ID
}

function groupIdsByCategory(transactions: Transaction[]) {
  return transactions.reduce<Map<string, string[]>>((groups, transaction) => {
    const ids = groups.get(transaction.category.id) ?? []
    return groups.set(transaction.category.id, [...ids, transaction.id])
  }, new Map())
}

export function UncategorizedQueue({ onReviewed }: { onReviewed?: () => void }) {
  const { canRead } = usePermissions()
  const canReadSettings = canRead('settings')
  const detailsTitleId = useId()
  const [{ data, error, fetching }, reexecuteQuery] = useQuery<{ transactions: TransactionConnection }, { input: TransactionsInput }>({
    query: TRANSACTIONS_QUERY,
    variables: { input: { filter: { isReviewed: false }, sort: { field: 'DATE', direction: 'DESC' }, first: PAGE_SIZE } },
  })
  const [{ data: configurationData, error: configurationError, fetching: configurationFetching }] = useQuery({ query: CONFIGURATION_QUERY, pause: !canReadSettings })
  const [{ data: stagedData, error: stagedError }, reexecuteStagedQuery] = useQuery<{ transactionsStagedForCategorization: TransactionsStagedForCategorization }>({
    query: TRANSACTIONS_STAGED_FOR_CATEGORIZATION_QUERY,
    requestPolicy: 'network-only',
  })
  const [, updateTransaction] = useMutation(UPDATE_TRANSACTION_MUTATION)
  const [, bulkUpdateTransactions] = useMutation(BULK_UPDATE_TRANSACTIONS_MUTATION)
  const [{ fetching: reprocessing }, reprocess] = useMutation(REPROCESS_UNCATEGORIZED_MUTATION)
  const { categories, fetching: categoriesFetching } = useCategories()
  const transactions = data?.transactions.edges.map((e) => e.node) ?? []
  const totalCount = data?.transactions.totalCount ?? transactions.length
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(() => new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const selectedTransaction = transactions.find((t) => t.id === selectedId)
  const llmEnabled = configurationData?.configuration.llmCategorization.enabled ?? false
  const configurationLoaded = !configurationFetching && configurationData != null
  const feedbackError = actionError ?? configurationError?.message
  const approvable = transactions.filter(isApprovable)

  useEffect(() => {
    const interval = window.setInterval(() => {
      reexecuteStagedQuery({ requestPolicy: 'network-only' })
    }, 10_000)
    return () => window.clearInterval(interval)
  }, [reexecuteStagedQuery])

  function refetch() {
    reexecuteQuery({ requestPolicy: 'network-only' })
    onReviewed?.()
  }

  function setUpdating(ids: string[], updating: boolean) {
    setUpdatingIds((current) => {
      const next = new Set(current)
      ids.forEach((id) => (updating ? next.add(id) : next.delete(id)))
      return next
    })
  }

  async function runCategorization(ids: string[], mutate: () => Promise<Array<{ error?: { message: string } }>>) {
    setActionError(null)
    setUpdating(ids, true)
    const results = await mutate()
    setUpdating(ids, false)
    const failure = results.find((result) => result.error)
    if (failure?.error) {
      setActionError(failure.error.message)
      return
    }
    refetch()
  }

  function categorize(id: string, categoryId: string) {
    return runCategorization([id], async () => [await updateTransaction({ input: { id, updates: { categoryId } } })])
  }

  function approveAll() {
    const groups = groupIdsByCategory(approvable)
    return runCategorization(approvable.map((transaction) => transaction.id), () => Promise.all(
      [...groups].map(([categoryId, transactionIds]) => bulkUpdateTransactions({ input: { transactionIds, updates: { categoryId } } })),
    ))
  }

  const handleReprocess = async () => {
    setActionError(null)
    setSuccess(null)
    const result = await reprocess({})
    if (result.error) {
      setActionError(result.error.message)
      return
    }
    const stagedCount = result.data?.reprocessUncategorizedTransactions.stagedCount ?? 0
    setSuccess(`Sent ${stagedCount} transaction${stagedCount === 1 ? '' : 's'} for categorization`)
    refetch()
  }

  const stagedCount = stagedData?.transactionsStagedForCategorization.count ?? 0
  const hasReviewWork = transactions.length > 0 || stagedCount > 0
  const processingStatus = stagedCount > 0 ? (
    <div aria-live="polite" className="flex items-center gap-2 text-[13px] text-text-muted" role="status">
      <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      Processing {stagedCount} Transactions...
    </div>
  ) : null
  const reprocessButton = canReadSettings && hasReviewWork ? (
    <Button
      disabled={!llmEnabled || reprocessing}
      onClick={handleReprocess}
      size="sm"
      title={configurationLoaded && !llmEnabled ? 'LLM Categorization must be enabled in AI settings' : undefined}
      variant="secondary"
    >
      Reprocess All
    </Button>
  ) : null
  const approveAllLabel = totalCount > transactions.length ? `Approve ${approvable.length} loaded` : 'Approve all'
  const showFeedbackError = Boolean(feedbackError) && (transactions.length > 0 || stagedCount > 0)
  const showSuccess = Boolean(success) && (transactions.length === 0 || canReadSettings)

  const rowProps = (transaction: Transaction) => ({
    action: isApprovable(transaction) ? (
      <Button
        disabled={updatingIds.has(transaction.id)}
        onClick={(event) => { event.stopPropagation(); void categorize(transaction.id, transaction.category.id) }}
        size="sm"
        variant="secondary"
      >
        Approve
      </Button>
    ) : undefined,
    categories,
    hasActionColumn: approvable.length > 0,
    isUpdatingCategory: updatingIds.has(transaction.id),
    onCategoryChange: (target: Transaction, category: { id: string }) => void categorize(target.id, category.id),
    onDetailsOpen: (target: Transaction) => setSelectedId(target.id),
    showDate: true,
    transaction,
  })

  return (
    <QueryGate
      data={categoriesFetching ? undefined : data}
      empty={false}
      emptyTitle="Review queue is clear"
      error={error}
      errorPrefix="Failed to load review queue"
      fetching={fetching || categoriesFetching}
      loadingLabel="Loading review queue"
      onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
    >
      <div className="space-y-4">
        {showFeedbackError ? <FormError>{feedbackError}</FormError> : null}
        {stagedError ? <FormError>{stagedError.message}</FormError> : null}
        {showSuccess ? <FormSuccess>{success}</FormSuccess> : null}
        {transactions.length === 0 ? (
          <>
            {processingStatus || reprocessButton ? <div className="flex flex-wrap items-center justify-end gap-3">{processingStatus}{reprocessButton}</div> : null}
            <EmptyState title="Review queue is clear" description="New uncategorized transactions will appear here." />
          </>
        ) : (
          <Card>
            <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3 lg:px-5">
              <span className="mr-auto text-[13px] text-text-muted">{totalCount} to review</span>
              {processingStatus}
              {reprocessButton}
              {approvable.length > 1 ? (
                <Button disabled={approvable.some((transaction) => updatingIds.has(transaction.id))} onClick={() => void approveAll()} size="sm">
                  {approveAllLabel}
                </Button>
              ) : null}
            </div>
            <div className="hidden border-t border-border lg:block">
              {transactions.map((transaction) => <TransactionRow key={transaction.id} {...rowProps(transaction)} />)}
            </div>
            <div className="border-t border-border lg:hidden">
              {transactions.map((transaction) => <MobileTransactionRow key={transaction.id} {...rowProps(transaction)} />)}
            </div>
          </Card>
        )}
        {selectedTransaction ? (
          <TransactionDetailsOverlay label={`Details for ${selectedTransaction.merchantName || selectedTransaction.originalName || 'transaction'}`} onClose={() => setSelectedId(null)} titleId={detailsTitleId}>
            <TransactionDetailsPane
              categories={categories}
              key={selectedTransaction.id}
              onClose={() => setSelectedId(null)}
              onDelete={() => { setSelectedId(null); refetch() }}
              onUpdate={refetch}
              titleId={detailsTitleId}
              transaction={selectedTransaction}
            />
          </TransactionDetailsOverlay>
        ) : null}
      </div>
    </QueryGate>
  )
}
