import { Loader2 } from 'lucide-react'
import { Button } from '../common/Button'
import { TextField, type FieldVariant } from '../common/FormControls'
import { formatUnitPrice } from '../../utils/currency'
import { formatTransactionDatetime } from '../../utils/dates'
import type { AssetSecurityForm } from './assetSecurityForm'

export function AssetTrackingFields({ form, variant = 'default' }: { form: AssetSecurityForm; variant?: FieldVariant }) {
  const { canEdit, draft, quoteState, updateDraft } = form
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <TextField disabled={!canEdit} label="Tracking ticker" onChange={form.setTrackingTicker} placeholder="Defaults to identifier" type="text" value={draft.trackingTicker} variant={variant} />
        <TextField ariaLabel="Tracking multiplier" disabled={!canEdit} label="Multiplier" onChange={(trackingMultiplier) => updateDraft({ trackingMultiplier })} step="0.01" type="number" value={draft.trackingMultiplier} variant={variant} />
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs">
        <Button className="gap-1" disabled={form.verifyDisabled} onClick={form.handleVerifyTicker} size="sm" type="button" variant="secondary">
          {quoteState.isQuoting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Verify ticker
        </Button>
        <span aria-live="polite" className="contents">
          {quoteState.quote ? (
            <span className="text-text-3">
              {formatUnitPrice(quoteState.quote.price)} <span className="text-text-faint">quoted {formatTransactionDatetime(quoteState.quote.asOf)}</span>
            </span>
          ) : null}
        </span>
        {quoteState.quoteError ? <span className="text-negative" role="alert">{quoteState.quoteError}</span> : null}
      </div>
      {form.trackingTickerError ? <p className="mt-2 text-xs text-negative" role="alert">{form.trackingTickerError}</p> : null}
    </div>
  )
}
