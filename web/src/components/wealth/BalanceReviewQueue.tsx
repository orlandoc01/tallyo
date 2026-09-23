import { useState } from 'react'
import { useQuery } from 'urql'
import { DataGridHeader, DataGridRow, dataGridNumericCell, dataGridTextCell } from '../common/DataGrid'
import { Card } from '../common/FormControls'
import { QueryGate } from '../common/QueryGate'
import { Tag } from '../common/Tag'
import { BALANCE_REVIEWS_QUERY } from '../../graphql/queries'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { BalanceSnapshotReview, BalanceSnapshotReviewList } from '../../types/graphql'
import { accountMaskedName } from '../../utils/accounts'
import { formatAccountType } from '../../utils/accountSubtypes'
import { formatCurrencyCompact } from '../../utils/currency'
import { formatDisplayDate } from '../../utils/dates'
import { BalanceReviewModal } from './BalanceReviewModal'

const DESKTOP_COLUMNS = 'minmax(0,1.6fr) minmax(0,1fr) 120px 120px 170px'
const MOBILE_COLUMNS = 'minmax(0,1fr) 90px'

export function BalanceReviewQueue() {
  const isMobile = useIsMobile()
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<{ balanceSnapshotReviews: BalanceSnapshotReviewList }>({ query: BALANCE_REVIEWS_QUERY })
  const [selectedReview, setSelectedReview] = useState<BalanceSnapshotReview | null>(null)

  const reviews = data?.balanceSnapshotReviews.items ?? []
  const columns = isMobile ? MOBILE_COLUMNS : DESKTOP_COLUMNS

  return (
    <QueryGate
      data={data}
      empty={reviews.length === 0}
      emptyTitle="No flagged balance snapshots"
      emptyDescription="Provider balance anomalies will appear here when a sync carries forward prior values."
      error={error}
      errorPrefix="Failed to load balance review queue"
      fetching={fetching}
      loadingLabel="Loading balance review queue"
      onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
    >
      <Card>
        <DataGridHeader gridTemplateColumns={columns} variant="list">
          <div>Account</div>
          {isMobile ? null : <div>Type</div>}
          <div className={dataGridNumericCell}>Provider</div>
          {isMobile ? null : <div className={dataGridNumericCell}>Carry-forward</div>}
          {isMobile ? null : <div className={dataGridNumericCell}>Flagged</div>}
        </DataGridHeader>
        {reviews.map((review) => (
          <DataGridRow gridTemplateColumns={columns} key={review.id} onClick={() => setSelectedReview(review)}>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-text-1">{accountMaskedName(review.account)}</span>
              {isMobile ? null : <Tag className="shrink-0" tint="amber">Balance anomaly</Tag>}
            </div>
            {isMobile ? null : <div className={`${dataGridTextCell} text-[13px] text-text-3`}>{formatAccountType(review.account.type)}{review.account.subtype ? ` / ${review.account.subtype}` : ''}</div>}
            <div className={`${dataGridNumericCell} font-medium text-warning`}>{formatCurrencyCompact(review.providerBalanceUSD)}</div>
            {isMobile ? null : <div className={`${dataGridNumericCell} font-medium text-positive`}>{formatCurrencyCompact(review.carryForwardBalanceUSD)}</div>}
            {isMobile ? null : (
              <div className={`${dataGridNumericCell} text-[13px] text-text-3`}>
                {dateRangeLabel(review)}
                <span className="text-text-muted"> · </span>
                <span className="text-text-muted">{snapshotCountLabel(review.flaggedSnapshotCount)}</span>
              </div>
            )}
          </DataGridRow>
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
    </QueryGate>
  )
}

function snapshotCountLabel(count: number) {
  return `${count} ${count === 1 ? 'snapshot' : 'snapshots'}`
}

function dateRangeLabel(review: BalanceSnapshotReview) {
  if (review.firstFlaggedDate === review.latestFlaggedDate) {
    return formatDisplayDate(review.firstFlaggedDate)
  }
  return `${formatDisplayDate(review.firstFlaggedDate)} - ${formatDisplayDate(review.latestFlaggedDate)}`
}
