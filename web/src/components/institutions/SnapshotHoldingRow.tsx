import { X } from 'lucide-react'
import { formatQuantity } from '../../utils/amount'
import { formatCurrency, formatUnitPrice } from '../../utils/currency'
import { ManualAccountBadge } from './ManualAccountBadge'
import { assetDisplayLabel, assetInputLabel, isCash, type SnapshotLine } from './accountSnapshotLines'

export function SnapshotHoldingRow({
  disabled,
  line,
  onCashChange,
  onQuantityChange,
  onValueChange,
  onRemove,
}: {
  disabled: boolean
  line: SnapshotLine
  onCashChange: (assetID: string, value: string) => void
  onQuantityChange: (assetID: string, value: string) => void
  onValueChange: (assetID: string, value: string) => void
  onRemove?: (assetID: string) => void
}) {
  const cash = isCash(line.asset)
  const label = assetDisplayLabel(line.asset)
  const inputLabel = assetInputLabel(line.asset)
  const quantity = line.quantity
  const unitLabel = quantity == null ? null : cash ? 'Cash' : line.price == null ? null : `Price ${formatUnitPrice(line.price)}`
  const inputClass = 'w-full rounded-xl border border-border-strong bg-surface text-text-1 dark:bg-bg px-2 py-1.5 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-raised disabled:text-text-3'
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-border px-3 py-2 text-sm sm:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="truncate font-medium text-text-1" title={label}>{label}</div>
          {line.manual ? <ManualAccountBadge label="Manual holding" /> : null}
        </div>
        {unitLabel ? <div className="text-xs text-text-3">{unitLabel}</div> : null}
      </div>
      <div className="flex items-start justify-end gap-2 sm:items-center">
        {disabled ? (
          <div aria-label={`Valuation for ${inputLabel}`} className="text-right">
            <div className="font-semibold tabular-nums text-text-1">{formatCurrency(line.valueUSD)}</div>
            {quantity != null && !cash ? <div className="text-xs tabular-nums text-text-3">{formatQuantity(quantity)}</div> : null}
          </div>
        ) : cash ? (
          <label className="w-28 text-right text-xs font-medium text-text-2 sm:w-32">
            <span className="sr-only">Cash balance</span>
            <input
              aria-label={`Cash balance for ${inputLabel}`}
              className={`${inputClass} text-sm`}
              onChange={(e) => onCashChange(line.asset.id, e.target.value)}
              step="any"
              type="number"
              value={line.valueText}
            />
          </label>
        ) : (
          <div className="w-28 space-y-1 sm:w-32">
            <label className="block">
              <span className="sr-only">Valuation</span>
              <input
                aria-label={`Valuation for ${inputLabel}`}
                className={`${inputClass} text-sm font-semibold text-text-1`}
                onChange={(e) => onValueChange(line.asset.id, e.target.value)}
                step="any"
                type="number"
                value={line.valueText}
              />
            </label>
            {quantity != null ? (
              <label className="block">
                <span className="sr-only">Quantity</span>
                <input
                  aria-label={`Quantity for ${inputLabel}`}
                  className={`${inputClass} text-xs text-text-3`}
                  onChange={(e) => onQuantityChange(line.asset.id, e.target.value)}
                  step="any"
                  type="number"
                  value={line.quantityText}
                />
              </label>
            ) : null}
          </div>
        )}
        {onRemove && !disabled ? (
          <button
            aria-label={`Remove ${inputLabel}`}
            className="rounded-xl p-1.5 text-text-muted hover:bg-negative/10 hover:text-negative focus:outline-none focus:ring-2 focus:ring-negative/30"
            onClick={() => onRemove(line.asset.id)}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
