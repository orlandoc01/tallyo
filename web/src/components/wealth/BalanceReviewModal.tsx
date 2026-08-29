import { useState } from 'react'
import { useMutation } from 'urql'
import { Button } from '../common/Button'
import { FormError } from '../common/FormControls'
import { Modal } from '../common/Modal'
import { ModalCloseButton } from '../common/ModalHeader'
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
    <Modal className="dark:bg-neutral-950 dark:ring-1 dark:ring-neutral-800" labelledBy="balance-review-title" onClose={onClose} scrollable size="lg">
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Balance review</p>
            <h2 className="mt-1 text-2xl font-bold text-neutral-950 dark:text-neutral-50" id="balance-review-title">{accountMaskedName(review.account)}</h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{formatAccountType(review.account.type)}{review.account.subtype ? ` / ${review.account.subtype}` : ''}</p>
          </div>
          <ModalCloseButton className="dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100" onClick={onClose} />
        </header>

        <section className="grid gap-3 rounded-2xl bg-neutral-50 p-4 dark:bg-neutral-900/70 sm:grid-cols-3">
          <TimelineValue label="First flagged" value={formatDisplayDate(review.firstFlaggedDate)} />
          <TimelineValue label="Latest flagged" value={formatDisplayDate(review.latestFlaggedDate)} />
          <TimelineValue label="Snapshots" value={String(review.flaggedSnapshotCount)} />
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <ComparisonCard label="Provider detected" tone="provider" value={formatCurrency(review.providerBalanceUSD)} />
          <ComparisonCard label="System carry-forward" tone="carry" value={formatCurrency(review.carryForwardBalanceUSD)} />
        </section>

        <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Difference</p>
          <p className="mt-1 text-xl font-bold text-neutral-950 dark:text-neutral-50">{formatSignedCurrency(difference)}</p>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{deviation == null ? 'Deviation unavailable because the carry-forward balance is zero.' : `${formatPercentChange(deviation)} versus the carry-forward balance.`}</p>
        </section>

        {review.flagReason ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
            <p className="font-semibold">Flag reason</p>
            <p className="mt-1">{review.flagReason}</p>
          </section>
        ) : null}

        {!canResolve ? <p className="rounded-2xl bg-neutral-100 p-3 text-sm text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">You need account write access to resolve balance reviews.</p> : null}
        {confirmUseProvider ? <FormError>Confirming will replace flagged carry-forward snapshots with provider balances and provider holdings for this date range.</FormError> : null}
        {mutationError ? <FormError>{mutationError}</FormError> : null}

        <footer className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button className="dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-neutral-50" disabled={resolving !== null} onClick={onClose} variant="ghost">Cancel</Button>
          <Button
            className={confirmUseProvider ? undefined : 'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800'}
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

function TimelineValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="mt-1 font-semibold text-neutral-950 dark:text-neutral-100">{value}</p>
    </div>
  )
}

function ComparisonCard({ label, tone, value }: { label: string; tone: 'provider' | 'carry'; value: string }) {
  return (
    <div className={tone === 'provider' ? 'rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-400/20 dark:bg-amber-500/10' : 'rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-400/20 dark:bg-emerald-500/10'}>
      <p className={tone === 'provider' ? 'text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300' : 'text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300'}>{label}</p>
      <p className={tone === 'provider' ? 'mt-2 text-2xl font-bold text-amber-900 dark:text-amber-100' : 'mt-2 text-2xl font-bold text-emerald-900 dark:text-emerald-100'}>{value}</p>
    </div>
  )
}
