import type { BalanceReviewAction, BalanceSnapshotReview } from '../../types/graphql'
import { accountMaskedName } from '../../utils/accounts'
import { formatCurrency, formatPercentChange, formatSignedCurrency } from '../../utils/currency'
import { formatDisplayDate } from '../../utils/dates'
import { FormError } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetDangerAction } from '../common/SheetDangerAction'
import { SheetAvatar, SheetHero } from '../common/SheetHero'
import { SheetStaticRow } from '../common/SheetRows'

export function BalanceReviewSheet({ canResolve, deviation, difference, mutationError, onApprove, onClose, onUseProvider, resolving, review, subtitle }: {
  canResolve: boolean
  deviation: number | null
  difference: number
  mutationError: string | null
  onApprove: () => void
  onClose: () => void
  onUseProvider: () => void
  resolving: BalanceReviewAction | null
  review: BalanceSnapshotReview
  subtitle: string
}) {
  const name = accountMaskedName(review.account)
  const busy = resolving !== null
  const footer = <MobileFilterFooter primaryDisabled={!canResolve || busy} primaryLabel={resolving === 'APPROVE_CHANGES' ? 'Approving…' : 'Approve changes'} onPrimary={onApprove} />

  return (
    <MobileSheet bodyClassName="pb-2" footer={footer} hideClose labelledBy="balance-review-sheet-title" maxHeight="84%" onClose={onClose} title="Balance review">
      <SheetHero
        avatar={<SheetAvatar glyph={name[0]} />}
        sub={subtitle}
        title={name}
        value={formatCurrency(review.providerBalanceUSD)}
        valueClassName="text-warning"
        valueSub={`carry-forward ${formatCurrency(review.carryForwardBalanceUSD)}`}
      />
      <SheetStaticRow label="First flagged" value={formatDisplayDate(review.firstFlaggedDate)} />
      <SheetStaticRow label="Latest flagged" value={formatDisplayDate(review.latestFlaggedDate)} />
      <SheetStaticRow label="Snapshots" value={String(review.flaggedSnapshotCount)} />
      <SheetStaticRow label="Provider detected" value={formatCurrency(review.providerBalanceUSD)} valueClassName="text-warning" />
      <SheetStaticRow label="System carry-forward" value={formatCurrency(review.carryForwardBalanceUSD)} valueClassName="text-positive" />
      <SheetStaticRow label="Difference" value={formatSignedCurrency(difference)} />
      <SheetStaticRow label="Deviation" value={deviation == null ? 'Unavailable (carry-forward is zero)' : formatPercentChange(deviation)} />
      {review.flagReason ? <SheetStaticRow label="Flag reason" value={review.flagReason} /> : null}
      {!canResolve ? <p className="py-3 text-[13px] text-text-2">You need account write access to resolve balance reviews.</p> : null}
      {mutationError ? <FormError className="my-3">{mutationError}</FormError> : null}
      <SheetDangerAction
        busy={resolving === 'USE_PROVIDER'}
        busyLabel="Restoring…"
        disabled={!canResolve || busy}
        hint="Replaces flagged carry-forward snapshots with provider balances and holdings."
        label="Use provider"
        onSelect={onUseProvider}
      />
    </MobileSheet>
  )
}
