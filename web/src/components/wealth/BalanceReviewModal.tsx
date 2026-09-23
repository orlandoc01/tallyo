import { useState } from 'react'
import { useMutation } from 'urql'
import { Button } from '../common/Button'
import { FormError } from '../common/FormControls'
import { Modal } from '../common/Modal'
import { ModalHeader } from '../common/ModalHeader'
import { StatBlock, StatGrid } from '../common/StatBlock'
import { RESOLVE_BALANCE_REVIEW_MUTATION } from '../../graphql/mutations'
import { usePermissions } from '../../hooks/usePermissions'
import type { BalanceReviewAction, BalanceSnapshotReview, ResolveBalanceReviewPayload } from '../../types/graphql'
import { accountMaskedName } from '../../utils/accounts'
import { formatAccountType } from '../../utils/accountSubtypes'
import { formatCurrency, formatPercentChange, formatSignedCurrency } from '../../utils/currency'
import { formatDisplayDate } from '../../utils/dates'

type ResolveBalanceReviewData = {
  resolveBalanceReview: ResolveBalanceReviewPayload
}

export function BalanceReviewModal({ onClose, onResolved, review }: { onClose: () => void; onResolved: () => void; review: BalanceSnapshotReview }) {
  const [, resolveReview] = useMutation<ResolveBalanceReviewData>(RESOLVE_BALANCE_REVIEW_MUTATION)
  const { canWrite } = usePermissions()
  const [confirmUseProvider, setConfirmUseProvider] = useState(false)
  const [resolving, setResolving] = useState<BalanceReviewAction | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const canResolve = canWrite('wealth')
  const difference = review.providerBalanceUSD - review.carryForwardBalanceUSD
  const deviation = review.carryForwardBalanceUSD === 0 ? null : (difference / Math.abs(review.carryForwardBalanceUSD)) * 100

  async function resolve(action: BalanceReviewAction) {
    setResolving(action)
    setMutationError(null)
    const result = await resolveReview({ input: { id: review.id, action } })
    setResolving(null)
    if (result.error) {
      setMutationError(result.error.message)
      return
    }
    onResolved()
  }

  return (
    <Modal label={`Balance review for ${accountMaskedName(review.account)}`} onClose={onClose} scrollable size="lg">
      <div className="space-y-5">
        <ModalHeader
          onClose={onClose}
          subtitle={`${formatAccountType(review.account.type)}${review.account.subtype ? ` / ${review.account.subtype}` : ''}`}
          title={accountMaskedName(review.account)}
        />

        <StatGrid className="rounded-md bg-surface-2 p-4" columns={2}>
          <StatBlock label="First flagged" value={formatDisplayDate(review.firstFlaggedDate)} />
          <StatBlock label="Latest flagged" value={formatDisplayDate(review.latestFlaggedDate)} />
          <StatBlock label="Snapshots" value={String(review.flaggedSnapshotCount)} />
        </StatGrid>

        <StatGrid columns={2}>
          <StatBlock label="Provider detected" value={<span className="text-warning">{formatCurrency(review.providerBalanceUSD)}</span>} />
          <StatBlock label="System carry-forward" value={<span className="text-positive">{formatCurrency(review.carryForwardBalanceUSD)}</span>} />
        </StatGrid>

        <StatBlock
          label="Difference"
          sublabel={deviation == null ? 'Deviation unavailable because the carry-forward balance is zero.' : `${formatPercentChange(deviation)} versus the carry-forward balance.`}
          value={formatSignedCurrency(difference)}
        />

        {review.flagReason ? (
          <div className="rounded-md border border-border px-4 py-3 text-[13px]">
            <p className="text-xs text-text-muted">Flag reason</p>
            <p className="mt-0.5 text-text-2">{review.flagReason}</p>
          </div>
        ) : null}

        {!canResolve ? <p className="rounded-md bg-raised px-4 py-3 text-[13px] text-text-2">You need account write access to resolve balance reviews.</p> : null}
        {confirmUseProvider ? <FormError>Confirming will replace flagged carry-forward snapshots with provider balances and provider holdings for this date range.</FormError> : null}
        {mutationError ? <FormError>{mutationError}</FormError> : null}

        <footer className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button disabled={resolving !== null} onClick={onClose} variant="ghost">Cancel</Button>
          <Button
            disabled={!canResolve || resolving !== null}
            onClick={() => {
              if (!confirmUseProvider) {
                setConfirmUseProvider(true)
                return
              }
              void resolve('USE_PROVIDER')
            }}
            variant={confirmUseProvider ? 'danger-solid' : 'secondary'}
          >
            {resolving === 'USE_PROVIDER' ? 'Restoring...' : confirmUseProvider ? 'Confirm Use Provider' : 'Use Provider'}
          </Button>
          <Button disabled={!canResolve || resolving !== null} onClick={() => void resolve('APPROVE_CHANGES')}>
            {resolving === 'APPROVE_CHANGES' ? 'Approving...' : 'Approve Changes'}
          </Button>
        </footer>
      </div>
    </Modal>
  )
}
