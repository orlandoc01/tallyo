import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useMutation, useQuery } from 'urql'
import { REPROCESS_UNCATEGORIZED_MUTATION, UPDATE_TRANSACTION_MUTATION } from '../../graphql/mutations'
import { CONFIGURATION_QUERY, TRANSACTIONS_QUERY, TRANSACTIONS_STAGED_FOR_CATEGORIZATION_QUERY } from '../../graphql/queries'
import { useCategories } from '../../hooks/useEntityQueries'
import { usePermissions } from '../../hooks/usePermissions'
import type { Transaction, TransactionsInput, TransactionsStagedForCategorization } from '../../types/graphql'
import { formatTransactionAmount, transactionAmountClassName } from '../../utils/currency'
import { ArrowUpRightLink, Button } from '../common/Button'
import { EmptyState } from '../common/EmptyState'
import { Card, FormError, FormSuccess } from '../common/FormControls'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { CategoryPicker } from './CategoryPicker'
import { TransactionDetailsPane } from './TransactionDetailsPane'
import { TransactionRow } from './TransactionRow'

export function UncategorizedQueue() {
  const { canRead } = usePermissions()
  const canReadSettings = canRead('settings')
  const [{ data, fetching }, reexecuteQuery] = useQuery<{ transactions: { edges: Array<{ node: Transaction }>; pageInfo: { hasNextPage: boolean; endCursor: string | null }; totalCount: number } }>({
    query: TRANSACTIONS_QUERY,
    variables: { input: { filter: { isReviewed: false }, sort: { field: 'DATE' as const, direction: 'DESC' as const }, first: 50 } satisfies TransactionsInput },
  })
  const [{ data: configurationData, error: configurationError, fetching: configurationFetching }] = useQuery({ query: CONFIGURATION_QUERY, pause: !canReadSettings })
  const [{ data: stagedData, error: stagedError }, reexecuteStagedQuery] = useQuery<{ transactionsStagedForCategorization: TransactionsStagedForCategorization }>({
    query: TRANSACTIONS_STAGED_FOR_CATEGORIZATION_QUERY,
    requestPolicy: 'network-only',
  })
  const [, updateTransaction] = useMutation(UPDATE_TRANSACTION_MUTATION)
  const [{ fetching: reprocessing }, reprocess] = useMutation(REPROCESS_UNCATEGORIZED_MUTATION)
  const { categories, fetching: categoriesFetching } = useCategories()
  const transactions = data?.transactions.edges.map((e) => e.node) ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [openPickerId, setOpenPickerId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const selectedTransaction = transactions.find((t) => t.id === selectedId)
  const showPane = !!(selectedTransaction && categories.length > 0)
  const llmEnabled = configurationData?.configuration.llmCategorization.enabled ?? false
  const configurationLoaded = !configurationFetching && configurationData != null
  const feedbackError = error ?? configurationError?.message
  const successFeedback = success ? <FormSuccess>{success}</FormSuccess> : null

  useEffect(() => {
    const interval = window.setInterval(() => {
      reexecuteStagedQuery({ requestPolicy: 'network-only' })
    }, 10_000)
    return () => window.clearInterval(interval)
  }, [reexecuteStagedQuery])

  function detailsPane(transaction: Transaction) {
    return (
      <TransactionDetailsPane
        categories={categories}
        key={transaction.id}
        onClose={() => setSelectedId(null)}
        onDelete={() => {
          setSelectedId(null)
          reexecuteQuery({ requestPolicy: 'network-only' })
        }}
        onUpdate={() => reexecuteQuery({ requestPolicy: 'network-only' })}
        transaction={transaction}
      />
    )
  }

  const handleSelectCategory = async (transactionId: string, categoryId: string) => {
    setUpdatingId(transactionId)
    setError(null)
    const result = await updateTransaction({ input: { id: transactionId, updates: { categoryId } } })
    if (result.error) {
      setError(result.error.message)
      setUpdatingId(null)
      return
    }
    reexecuteQuery({ requestPolicy: 'network-only' })
  }

  const handleReprocess = async () => {
    setError(null)
    setSuccess(null)
    const result = await reprocess({})
    if (result.error) {
      setError(result.error.message)
      return
    }
    const stagedCount = result.data?.reprocessUncategorizedTransactions.stagedCount ?? 0
    setSuccess(`Sent ${stagedCount} transaction${stagedCount === 1 ? '' : 's'} for categorization`)
    reexecuteQuery({ requestPolicy: 'network-only' })
  }

  const stagedCount = stagedData?.transactionsStagedForCategorization.count ?? 0
  const hasReviewWork = transactions.length > 0 || stagedCount > 0
  const reviewActions = hasReviewWork || canReadSettings ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {stagedCount > 0 ? (
        <div aria-live="polite" className="flex items-center gap-2 text-sm text-neutral-500" role="status">
          <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          Processing {stagedCount} Transactions...
        </div>
      ) : null}
      {canReadSettings ? (
        <>
          {hasReviewWork ? (
            <Button
              disabled={!llmEnabled || reprocessing}
              onClick={handleReprocess}
              title={configurationLoaded && !llmEnabled ? 'LLM Categorization must be enabled in AI settings' : undefined}
              variant="secondary"
            >
              Reprocess All
            </Button>
          ) : null}
          <ArrowUpRightLink label="Open LLM categorization settings" to="/settings/ai-integration">
            Configure LLM
          </ArrowUpRightLink>
        </>
      ) : null}
    </div>
  ) : null

  if (fetching || categoriesFetching) {
    return <div className="space-y-4">{successFeedback}<LoadingSpinner label="Loading review queue" /></div>
  }
  if (transactions.length === 0) {
    return (
      <div className="space-y-4">
        {stagedCount > 0 && feedbackError ? <FormError>{feedbackError}</FormError> : null}
        {stagedError ? <FormError>{stagedError.message}</FormError> : null}
        {reviewActions}
        {successFeedback}
        <EmptyState title="Review queue is clear" description="New uncategorized transactions will appear here." />
      </div>
    )
  }

  return (
    <div className={showPane ? 'grid gap-6 xl:grid-cols-[1fr_20rem]' : undefined}>
      <div className="space-y-4">
        {feedbackError ? <FormError>{feedbackError}</FormError> : null}
        {stagedError ? <FormError>{stagedError.message}</FormError> : null}
        {reviewActions}
        {canReadSettings ? successFeedback : null}

        {/* Mobile compact list */}
        <Card className="lg:hidden">
          {transactions.map((transaction) => {
            const merchant = transaction.merchantName || transaction.originalName || 'Unknown merchant'
            const isOpen = openPickerId === transaction.id
            const isUpdating = updatingId === transaction.id
            return (
              <div key={transaction.id}>
                <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3">
                  <button
                    aria-label={`Pick category for ${merchant}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-base"
                    onClick={() => setOpenPickerId(isOpen ? null : transaction.id)}
                    type="button"
                  >
                    {transaction.category?.emoji ?? '❓'}
                  </button>
                  <div
                    aria-label={`View details for ${merchant}`}
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() => setSelectedId(transaction.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(transaction.id) }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="truncate text-sm font-medium text-neutral-950">{merchant}</div>
                    <div className="text-xs text-neutral-400">{transaction.datetime?.slice(0, 10)}</div>
                  </div>
                  <span className={clsx('shrink-0 text-sm font-semibold tabular-nums', transactionAmountClassName(transaction.amount))}>
                    {formatTransactionAmount(transaction.amount)}
                  </span>
                </div>
                {isOpen && (
                  <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-3">
                    {isUpdating ? (
                      <div className="py-2 text-center text-sm text-neutral-500">Categorizing…</div>
                    ) : (
                      <CategoryPicker
                        categories={categories}
                        onSelect={(category) => {
                          setOpenPickerId(null)
                          handleSelectCategory(transaction.id, category.id)
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </Card>

        {/* Desktop expanded card list */}
        <div className="hidden space-y-4 lg:block">
          {transactions.map((transaction) => (
            <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-card" key={transaction.id}>
              <table className="mb-4 w-full">
                <tbody>
                  <TransactionRow
                    categories={categories}
                    onCategoryChange={(_txn, category) => handleSelectCategory(transaction.id, category.id)}
                    onDetailsOpen={(txn) => setSelectedId(txn.id)}
                    transaction={transaction}
                  />
                </tbody>
              </table>
              {updatingId === transaction.id ? (
                <div className="flex items-center justify-center py-4 text-sm text-neutral-500">Categorizing...</div>
              ) : (
                <CategoryPicker autoFocus={false} categories={categories} onSelect={(category) => handleSelectCategory(transaction.id, category.id)} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Same pane rendered for the desktop side panel (xl+) and the mobile
          full-screen overlay; CSS shows exactly one. */}
      {showPane ? (
        <>
          <div className="hidden xl:block">{detailsPane(selectedTransaction)}</div>
          <div className="fixed inset-0 z-40 overflow-y-auto bg-white xl:hidden">{detailsPane(selectedTransaction)}</div>
        </>
      ) : null}
    </div>
  )
}
