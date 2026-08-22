import { useId } from 'react'
import { SelectField, TextField } from '../common/FormControls'
import { ToggleSwitch } from '../common/ToggleSwitch'
import type { AssetClassifier } from '../../types/graphql'
import { getTrackingTickerError } from './assetPriceValidation'
import { AssetTrackingFields } from './AssetTrackingFields'
import { CLASSIFIER_LABELS } from './assetFormOptions'
import type { useAssetQuote } from './useAssetQuote'

type AssetInfoDraft = {
  identifier: string
  name: string
  classifier: AssetClassifier
}

type AssetSecurityDraft = {
  identifier: string
  customTracking: boolean
  forcePrice: boolean
  forcedUsdPrice: string
  trackingMultiplier: string
  trackingTicker: string
}

type AssetQuoteState = Pick<ReturnType<typeof useAssetQuote>, 'clearQuote' | 'isQuoting' | 'quote' | 'quoteError'>

export function AssetInfoFields({
  availableClassifiers,
  canEdit,
  classifierLocked,
  lockedClassifierNote,
  draft,
  updateDraft,
}: {
  availableClassifiers: AssetClassifier[]
  canEdit: boolean
  classifierLocked: boolean
  lockedClassifierNote?: string
  draft: AssetInfoDraft
  updateDraft: (draft: Partial<AssetInfoDraft>) => void
}) {
  return (
    <>
      <TextField disabled={!canEdit} label="Identifier (ticker/symbol)" onChange={(identifier) => updateDraft({ identifier })} type="text" value={draft.identifier} />
      <TextField disabled={!canEdit} label="Name" onChange={(name) => updateDraft({ name })} type="text" value={draft.name} />

      {classifierLocked ? (
        <label className="block">
          <span className="text-sm font-medium text-neutral-700">Asset Class</span>
          <p className="mt-1 text-sm text-neutral-500">
            {CLASSIFIER_LABELS[draft.classifier]}{lockedClassifierNote ? ` (${lockedClassifierNote})` : ''}
          </p>
        </label>
      ) : (
        <SelectField
          disabled={!canEdit}
          label="Asset Class"
          onChange={(classifier) => updateDraft({ classifier })}
          options={availableClassifiers.map((classifier) => ({ label: CLASSIFIER_LABELS[classifier], value: classifier }))}
          value={draft.classifier}
        />
      )}
    </>
  )
}

export function AssetSecurityFields({
  canEdit,
  draft,
  onVerify,
  quoteState,
  updateDraft,
}: {
  canEdit: boolean
  draft: AssetSecurityDraft
  onVerify: () => void
  quoteState: AssetQuoteState
  updateDraft: (draft: Partial<AssetSecurityDraft>) => void
}) {
  const { clearQuote, isQuoting, quote, quoteError } = quoteState
  const descriptionId = useId()
  const fieldsId = useId()
  const tickerError = getTrackingTickerError(draft.customTracking, draft.trackingTicker, draft.identifier)

  function handleCustomTrackingChange(customTracking: boolean) {
    updateDraft({ customTracking })
    clearQuote()
  }

  function handleTickerChange(trackingTicker: string) {
    updateDraft({ trackingTicker })
    clearQuote()
  }

  return (
    <>
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
        <div className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-neutral-700">Custom Tracking</span>
            <span className="block text-xs text-neutral-500" id={descriptionId}>
              Price this asset from a different ticker via Yahoo Finance and use it for Portfolio classification of public securities.
            </span>
          </span>
          <ToggleSwitch
            aria-controls={fieldsId}
            aria-describedby={descriptionId}
            checked={draft.customTracking}
            disabled={!canEdit}
            label="Custom Tracking"
            onChange={handleCustomTrackingChange}
          />
        </div>
        {draft.customTracking ? (
          <div className="mt-3 space-y-2" id={fieldsId}>
            <AssetTrackingFields
              canEdit={canEdit}
              isQuoting={isQuoting}
              onMultiplierChange={(trackingMultiplier) => updateDraft({ trackingMultiplier })}
              onTickerChange={handleTickerChange}
              onVerify={onVerify}
              quote={quote}
              quoteError={quoteError}
              trackingMultiplier={draft.trackingMultiplier}
              trackingTicker={draft.trackingTicker}
              verifyDisabled={isQuoting || !canEdit || !draft.trackingTicker.trim()}
            />
            {tickerError ? <p className="text-xs text-red-600" role="alert">{tickerError}</p> : null}
          </div>
        ) : null}
      </div>
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
        <div className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-neutral-700">Force Price</span>
            <span className="block text-xs text-neutral-500">Override pricing with a fixed USD unit price.</span>
          </span>
          <ToggleSwitch checked={draft.forcePrice} disabled={!canEdit} label="Override pricing with fixed price" onChange={(forcePrice) => updateDraft({ forcePrice })} />
        </div>
        {draft.forcePrice ? (
          <TextField className="mt-3 max-w-40" controlClassName="rounded-lg" disabled={!canEdit} label="USD price per unit" min="0" onChange={(forcedUsdPrice) => updateDraft({ forcedUsdPrice })} step="0.01" type="number" value={draft.forcedUsdPrice} />
        ) : null}
      </div>
    </>
  )
}
