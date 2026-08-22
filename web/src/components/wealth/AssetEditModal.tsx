import { useReducer, type FormEvent } from 'react'
import { useMutation } from 'urql'
import { Modal, ModalActions } from '../common/Modal'
import { ModalTitleRow } from '../common/ModalHeader'
import { SegmentedNavTabs } from '../common/SegmentedNavTabs'
import { UPDATE_ASSET_MUTATION } from '../../graphql/mutations'
import { amountVisibilityFromParams } from '../../hooks/amountVisibilityParam'
import { usePermissions } from '../../hooks/usePermissions'
import { formatUnitPrice } from '../../utils/currency'
import type { Asset, AssetClassifier, UpdateAssetInput } from '../../types/graphql'
import { AssetAccountsList } from './AssetAccountsList'
import { AssetInfoFields, AssetSecurityFields } from './AssetFormFields'
import { AssetMergePicker } from './AssetMergePicker'
import type { AssetEditTab } from './assetEditTabs'
import { CLASSIFIER_OPTIONS } from './assetFormOptions'
import { getAssetPriceValidation, getTrackingTickerError } from './assetPriceValidation'
import { useAssetQuote } from './useAssetQuote'

type AssetEditDraft = {
  identifier: string
  name: string
  classifier: AssetClassifier
  customTracking: boolean
  trackingTicker: string
  trackingMultiplier: string
  forcePrice: boolean
  forcedUsdPrice: string
}

type AssetEditState = {
  draft: AssetEditDraft
  isSaving: boolean
  error: string | null
}

type AssetEditAction =
  | { type: 'draft'; draft: Partial<AssetEditDraft> }
  | { type: 'saveStarted' }
  | { type: 'saveFailed'; error: string }
  | { type: 'saveFinished' }

function initialAssetEditState(asset: Asset): AssetEditState {
  const isSecurity = asset.assetType === 'SECURITY'

  return {
    draft: {
      identifier: asset.identifier,
      name: asset.name ?? '',
      classifier: asset.classifier,
      // Post-migration, a nonnull trackingTicker always means a genuine
      // custom tracker (see server/internal/wealth.NormalizeTracking).
      customTracking: asset.trackingTicker != null,
      trackingTicker: asset.trackingTicker ?? '',
      trackingMultiplier: String(asset.trackingMultiplier),
      forcePrice: isSecurity && asset.forcedUsdPrice != null,
      forcedUsdPrice: asset.forcedUsdPrice != null ? String(asset.forcedUsdPrice) : '',
    },
    isSaving: false,
    error: null,
  }
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase()
}

function assetEditReducer(state: AssetEditState, action: AssetEditAction): AssetEditState {
  switch (action.type) {
    case 'draft':
      return { ...state, draft: { ...state.draft, ...action.draft } }
    case 'saveStarted':
      return { ...state, isSaving: true, error: null }
    case 'saveFailed':
      return { ...state, isSaving: false, error: action.error }
    case 'saveFinished':
      return { ...state, isSaving: false }
  }
}

export function AssetEditModal({
  asset,
  activeTab = 'info',
  basePath,
  tabSearch = '',
  onClose,
  onUpdate,
}: {
  asset: Asset
  activeTab?: AssetEditTab
  basePath: string
  tabSearch?: string
  onClose: () => void
  onUpdate?: (asset: Asset) => void
}) {
  const { canRead, canWrite } = usePermissions()
  const canEdit = canWrite('assets')
  const canReadAssetAccounts = canRead('assets') && canRead('holdings')
  const amountsHidden = amountVisibilityFromParams(new URLSearchParams(tabSearch))
  const [, updateAsset] = useMutation(UPDATE_ASSET_MUTATION)
  const quoteState = useAssetQuote()
  const { verifyTicker } = quoteState

  const isSecurity = asset.assetType === 'SECURITY'
  const isRealEstate = asset.assetType === 'REAL_ESTATE'
  const isCurrency = asset.assetType === 'CURRENCY'
  const hasTrackingTab = isSecurity || asset.adapterSources.length > 0
  const currentTab = activeTab === 'tracking' && !hasTrackingTab ? 'info' : activeTab
  const hasConnectivityIssue = asset.priceConnectivity === 'NOT_FOUND' || asset.investmentConnectivity === 'NOT_FOUND'

  const availableClassifiers = CLASSIFIER_OPTIONS[asset.assetType] ?? ['CASH']
  const classifierLocked = isCurrency || isRealEstate

  const [state, dispatch] = useReducer(assetEditReducer, asset, initialAssetEditState)
  const { draft, isSaving, error } = state

  function updateDraft(draftUpdate: Partial<AssetEditDraft>) {
    dispatch({ type: 'draft', draft: draftUpdate })
  }

  const initialCustomTracking = isSecurity && asset.trackingTicker != null
  const initialTrackingTicker = asset.trackingTicker ?? ''
  const initialForcePrice = isSecurity && asset.forcedUsdPrice != null
  const initialForcedUsdPrice = asset.forcedUsdPrice != null ? String(asset.forcedUsdPrice) : ''
  const { forcedUsdPriceValue, isForcedUsdPriceValid, isTrackingMultiplierValid, trackingMultiplierValue } = getAssetPriceValidation(draft.trackingMultiplier, draft.forcedUsdPrice)
  const trackingTickerError = isSecurity ? getTrackingTickerError(draft.customTracking, draft.trackingTicker, draft.identifier) : null
  const isTrackingDirty = isSecurity && (
    draft.customTracking !== initialCustomTracking
    || (draft.customTracking && (
      normalizeTicker(draft.trackingTicker) !== normalizeTicker(initialTrackingTicker)
      || trackingMultiplierValue !== asset.trackingMultiplier
    ))
  )
  const isForcePriceDirty = isSecurity && (
    draft.forcePrice !== initialForcePrice
    || (draft.forcePrice && draft.forcedUsdPrice !== initialForcedUsdPrice)
  )

  const isDirty = (draft.identifier !== asset.identifier || draft.name !== (asset.name ?? '')
    || draft.classifier !== asset.classifier
    || isTrackingDirty
    || isForcePriceDirty
  )
  const canSave = isDirty && canEdit && !isSaving && (!isSecurity || (
    !trackingTickerError
    && (!draft.customTracking || isTrackingMultiplierValid)
    && (!draft.forcePrice || isForcedUsdPriceValid)
  ))

  async function handleVerifyTicker() {
    const assetQuote = await verifyTicker(draft.trackingTicker)
    // Prefill the multiplier so saving this ticker preserves the asset's current
    // valuation by default; the user can still edit it to change the valuation.
    if (asset.currentPrice != null && assetQuote && assetQuote.price > 0) {
      updateDraft({ trackingMultiplier: String(Number((asset.currentPrice / assetQuote.price).toFixed(6))) })
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    dispatch({ type: 'saveStarted' })

    const input: UpdateAssetInput = { id: asset.id }
    if (draft.identifier !== asset.identifier) {
      input.identifier = draft.identifier || null
    }
    if (draft.name !== (asset.name ?? '')) {
      input.name = draft.name || null
    }
    if (draft.classifier !== asset.classifier) {
      input.classifier = draft.classifier
    }
    if (isSecurity) {
      if (isTrackingDirty) {
        // Empty string / 1 is the documented clear sentinel for updateAsset:
        // gqlgen maps an omitted field and explicit null to the same nil, so
        // only an explicit empty string can clear a previously stored ticker.
        input.trackingTicker = draft.customTracking ? draft.trackingTicker.trim() : ''
        input.trackingMultiplier = draft.customTracking ? trackingMultiplierValue : 1
      }
      if (isForcePriceDirty) {
        input.forcePrice = draft.forcePrice
        if (draft.forcePrice) {
          input.forcedUsdPrice = forcedUsdPriceValue
        }
      }
    }
    const variables = { input }

    const result = await updateAsset(variables)
    if (result.error) {
      dispatch({ type: 'saveFailed', error: result.error.message })
      return
    }
    const updated = result.data?.updateAsset?.asset
    if (updated) {
      onUpdate?.(updated)
    }
    dispatch({ type: 'saveFinished' })
    onClose()
  }

  return (
    <Modal onClose={onClose} label={`Edit ${asset.name ?? asset.identifier}`} scrollable>
      <form className="space-y-5" onSubmit={handleSave}>
        <ModalTitleRow onClose={onClose} title="Edit Asset" />

        <div className="space-y-1 text-sm text-neutral-500">
          <p>
            <span className="font-medium text-neutral-700">Type:</span> {asset.assetType}
            &middot; <span className="text-neutral-400">{asset.classifier}</span>
          </p>
          {asset.currentPrice != null ? (
            <p>
              <span className="font-medium text-neutral-700">Price:</span> {formatUnitPrice(asset.currentPrice)}
            </p>
          ) : null}
        </div>

        {hasConnectivityIssue ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This ticker can&apos;t be found on Yahoo Finance. Update the tracking ticker or identifier to fix pricing.
          </div>
        ) : null}

        <SegmentedNavTabs
          ariaLabel="Asset edit sections"
          items={hasTrackingTab
            ? [
              { to: `${basePath}/info${tabSearch}`, children: 'Info' },
              { to: `${basePath}/tracking${tabSearch}`, children: 'Tracking' },
            ]
            : [{ to: `${basePath}/info${tabSearch}`, children: 'Info' }]}
        />

        {currentTab === 'info' ? (
          <div className="space-y-4">
            {isRealEstate ? (
              <p className="text-sm text-neutral-500">
                Real estate assets are managed through the Accounts page.
              </p>
            ) : (
              <AssetInfoFields availableClassifiers={availableClassifiers} canEdit={canEdit} classifierLocked={classifierLocked} draft={draft} updateDraft={updateDraft} />
            )}
            {canReadAssetAccounts ? <AssetAccountsList amountsHidden={amountsHidden} assetId={asset.id} /> : null}
          </div>
        ) : null}

        {currentTab === 'tracking' && hasTrackingTab ? (
          <div className="space-y-4">
            {isSecurity ? (
              <AssetSecurityFields canEdit={canEdit} draft={draft} onVerify={handleVerifyTicker} quoteState={quoteState} updateDraft={updateDraft} />
            ) : null}
            <AssetMergePicker asset={asset} canEdit={canEdit} onClose={onClose} onUpdate={onUpdate} />
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {canEdit && !isRealEstate ? <ModalActions busy={isSaving} busyLabel="Saving…" disabled={!canSave} onCancel={onClose} /> : null}
      </form>
    </Modal>
  )
}
