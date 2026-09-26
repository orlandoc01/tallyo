import clsx from 'clsx'
import type { RecurringCharge } from '../../types/graphql'
import { categoryTint } from '../../utils/categoryTint'
import { formatTransactionAmount, transactionAmountClassName } from '../../utils/currency'
import { formatDisplayDate } from '../../utils/dates'
import { tagTintBgClass } from '../../utils/tagTints'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetAvatar, SheetHero } from '../common/SheetHero'
import { SheetStaticRow } from '../common/SheetRows'
import { CategoryTag } from '../common/Tag'
import { cadenceLabel, chargeAccount } from './recurringCadence'

// Read-only: the API exposes no mutation for a recurring stream's cadence,
// category or active flag, so those rows are static and there is no
// "Stop tracking" action.
export function RecurringDetailSheet({ charge, onClose, onViewTransactions }: {
  charge: RecurringCharge
  onClose: () => void
  onViewTransactions: (charge: RecurringCharge) => void
}) {
  const tint = charge.category ? categoryTint(charge.category) : 'gray'
  return (
    <MobileSheet
      bodyClassName="pb-2"
      footer={<MobileFilterFooter primaryLabel="Done" secondaryLabel="View transactions" secondaryVariant="outline-accent" onPrimary={onClose} onSecondary={() => onViewTransactions(charge)} />}
      hideClose
      labelledBy="recurring-detail-title"
      maxHeight="84%"
      onClose={onClose}
      title="Recurring"
    >
      <div aria-label={`Details for ${charge.merchantName}`} role="region">
        <SheetHero
          avatar={<SheetAvatar className={clsx(tagTintBgClass[tint], 'text-text-1')} glyph={charge.category?.emoji ?? '•'} />}
          sub={chargeAccount(charge)}
          title={charge.merchantName}
          value={formatTransactionAmount(charge.estimatedAmount)}
          valueClassName={transactionAmountClassName(charge.estimatedAmount)}
        />
        <SheetStaticRow label="Frequency" value={cadenceLabel(charge.interval ?? null)} />
        <SheetStaticRow label="Next expected" value={charge.nextExpectedDate ? formatDisplayDate(charge.nextExpectedDate) : '—'} />
        <SheetStaticRow label="Last paid" value={formatDisplayDate(charge.lastDate)} />
        <SheetStaticRow label="Category" value={charge.category ? <CategoryTag category={charge.category} /> : '—'} />
      </div>
    </MobileSheet>
  )
}
