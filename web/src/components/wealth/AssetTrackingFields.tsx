import { Loader2 } from 'lucide-react'
import { Button } from '../common/Button'
import { TextField } from '../common/FormControls'
import { formatUnitPrice } from '../../utils/currency'
import { formatTransactionDatetime } from '../../utils/dates'

// Tracking ticker + multiplier inputs with quote verification, shared by the
// asset create and edit modals (each keeps its own quote-fetch logic).
export function AssetTrackingFields({
  canEdit,
  isQuoting,
  onMultiplierChange,
  onTickerChange,
  onVerify,
  quote,
  quoteError,
  trackingMultiplier,
  trackingTicker,
  verifyDisabled,
}: {
  canEdit: boolean
  isQuoting: boolean
  onMultiplierChange: (value: string) => void
  onTickerChange: (value: string) => void
  onVerify: () => void
  quote: { price: number; asOf: string } | null
  quoteError: string | null
  trackingMultiplier: string
  trackingTicker: string
  verifyDisabled: boolean
}) {
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <TextField controlClassName="rounded-lg" disabled={!canEdit} label="Tracking ticker" onChange={onTickerChange} placeholder="Defaults to identifier" type="text" value={trackingTicker} />
        <TextField ariaLabel="Tracking multiplier" controlClassName="rounded-lg" disabled={!canEdit} label="Multiplier" onChange={onMultiplierChange} step="0.01" type="number" value={trackingMultiplier} />
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs">
        <Button className="gap-1" disabled={verifyDisabled} onClick={onVerify} size="sm" type="button" variant="secondary">
          {isQuoting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Verify ticker
        </Button>
        <span aria-live="polite" className="contents">
          {quote ? (
            <span className="text-neutral-500">
              {formatUnitPrice(quote.price)} <span className="text-neutral-400">quoted {formatTransactionDatetime(quote.asOf)}</span>
            </span>
          ) : null}
        </span>
        {quoteError ? <span className="text-red-500" role="alert">{quoteError}</span> : null}
      </div>
    </div>
  )
}
