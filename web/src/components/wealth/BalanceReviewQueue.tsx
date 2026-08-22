import { useState } from 'react'
import { useQuery } from 'urql'
import { Card } from '../common/FormControls'
import { QueryGate } from '../common/QueryGate'
import { BALANCE_REVIEWS_QUERY } from '../../graphql/queries'
import type { BalanceSnapshotReview, BalanceSnapshotReviewList } from '../../types/graphql'
import { accountMaskedName } from '../../utils/accounts'
import { formatAccountType } from '../../utils/accountSubtypes'
import { formatCurrencyCompact } from '../../utils/currency'
import { formatDisplayDate } from '../../utils/dates'
import { BalanceReviewModal } from './BalanceReviewModal'

export function BalanceReviewQueue() {
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<{ balanceSnapshotReviews: BalanceSnapshotReviewList }>({ query: BALANCE_REVIEWS_QUERY })
  const [selectedReview, setSelectedReview] = useState<BalanceSnapshotReview | null>(null)

  const reviews = data?.balanceSnapshotReviews.items ?? []

  return (
    <QueryGate
      data={data}
      empty={reviews.length === 0}
      emptyTitle="No flagged balance snapshots to review."
      emptyDescription="Provider balance anomalies will appear here when a sync carries forward prior values."
      error={error}
      errorPrefix="Failed to load balance review queue"
      fetching={fetching}
      loadingLabel="Loading balance review queue"
      onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
    >
      <div className="space-y-4">
        <Card>
          {reviews.map((review) => (
            <button
              className="grid w-full gap-4 border-b border-neutral-100 px-5 py-4 text-left transition last:border-b-0 hover:bg-neutral-50 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-center"
              key={review.id}
              onClick={() => setSelectedReview(review)}
              type="button"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-neutral-950">{accountMaskedName(review.account)}</p>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Balance anomaly</span>
                </div>
                <p className="mt-1 text-sm text-neutral-500">{formatAccountType(review.account.type)}{review.account.subtype ? ` / ${review.account.subtype}` : ''}</p>
              </div>
              <BalanceValue label="Provider detected" tone="provider" value={review.providerBalanceUSD} />
              <BalanceValue label="System carry-forward" tone="carry" value={review.carryForwardBalanceUSD} />
              <div className="rounded-2xl bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-700 sm:text-right">
                <div>{dateRangeLabel(review)}</div>
                <div className="text-xs text-neutral-500">{review.flaggedSnapshotCount} {review.flaggedSnapshotCount === 1 ? 'snapshot' : 'snapshots'}</div>
              </div>
            </button>
          ))}
        </Card>
        {selectedReview ? (
          <BalanceReviewModal
            onClose={() => setSelectedReview(null)}
            onResolved={() => {
              setSelectedReview(null)
              reexecuteQuery({ requestPolicy: 'network-only' })
            }}
            review={selectedReview}
          />
        ) : null}
      </div>
    </QueryGate>
  )
}

function BalanceValue({ label, tone, value }: { label: string; tone: 'provider' | 'carry'; value: number }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={tone === 'provider' ? 'text-lg font-bold text-amber-700' : 'text-lg font-bold text-emerald-700'}>{formatCurrencyCompact(value)}</p>
    </div>
  )
}

function dateRangeLabel(review: BalanceSnapshotReview) {
  if (review.firstFlaggedDate === review.latestFlaggedDate) {
    return formatDisplayDate(review.firstFlaggedDate)
  }
  return `${formatDisplayDate(review.firstFlaggedDate)} - ${formatDisplayDate(review.latestFlaggedDate)}`
}
