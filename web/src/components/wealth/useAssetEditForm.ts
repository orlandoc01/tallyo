import { useReducer } from 'react'
import { useMutation } from 'urql'
import { UPDATE_ASSET_MUTATION } from '../../graphql/mutations'
import { amountVisibilityFromParams } from '../../hooks/amountVisibilityParam'
import { usePermissions } from '../../hooks/usePermissions'
import type { Asset, AssetClassifier, UpdateAssetInput } from '../../types/graphql'
import { CLASSIFIER_OPTIONS } from './assetFormOptions'
import { getAssetPriceValidation } from './assetPriceValidation'
import { securityTrackingControls } from './assetSecurityForm'
import { useAssetQuote } from './useAssetQuote'

export const CONNECTIVITY_WARNING = "This ticker can't be found on Yahoo Finance. Update the tracking ticker or identifier to fix pricing."

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
      // custom tracker (see server-rs/src/wealth/tracking.rs).
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

export function useAssetEditForm({ asset, onClose, onUpdate, tabSearch }: {
  asset: Asset
  onClose: () => void
  onUpdate?: (asset: Asset) => void
  tabSearch: string
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
  const tracking = securityTrackingControls({ canEdit, draft, quoteState, updateDraft })
  const { trackingTickerError } = tracking
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

  async function handleSave() {
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
        // The GraphQL binding maps an omitted field and explicit null to the same
        // value, so only an explicit empty string can clear a stored ticker.
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

  return {
    ...tracking,
    amountsHidden,
    availableClassifiers,
    canEdit,
    canReadAssetAccounts,
    canSave,
    classifierLocked,
    draft,
    error,
    handleSave,
    handleVerifyTicker,
    hasConnectivityIssue,
    hasTrackingTab,
    isRealEstate,
    isSecurity,
    isSaving,
    quoteState,
    updateDraft,
  }
}
