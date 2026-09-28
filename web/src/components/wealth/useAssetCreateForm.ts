import { useState } from 'react'
import { useMutation } from 'urql'
import { CREATE_ASSET_MUTATION } from '../../graphql/mutations'
import { usePermissions } from '../../hooks/usePermissions'
import type { Asset, AssetClassifier, AssetType, CreateAssetInput } from '../../types/graphql'
import { CLASSIFIER_OPTIONS, defaultClassifierForAssetType } from './assetFormOptions'
import { getAssetPriceValidation } from './assetPriceValidation'
import { securityTrackingControls } from './assetSecurityForm'
import { useAssetQuote } from './useAssetQuote'

export const CREATE_ASSET_TYPES: AssetType[] = ['CURRENCY', 'SECURITY', 'CRYPTO', 'OTHER']

type AssetCreateDraft = {
  assetType: AssetType
  identifier: string
  name: string
  classifier: AssetClassifier
  customTracking: boolean
  trackingTicker: string
  trackingMultiplier: string
  forcePrice: boolean
  forcedUsdPrice: string
  cusip: string
  isin: string
}

const initialDraft: AssetCreateDraft = {
  assetType: 'SECURITY',
  identifier: '',
  name: '',
  classifier: 'PUBLIC',
  customTracking: false,
  trackingTicker: '',
  trackingMultiplier: '1',
  forcePrice: false,
  forcedUsdPrice: '',
  cusip: '',
  isin: '',
}

export function useAssetCreateForm({ onClose, onCreate }: { onClose: () => void; onCreate?: (asset: Asset) => void }) {
  const { canWrite } = usePermissions()
  const canEdit = canWrite('assets')
  const [, createAsset] = useMutation(CREATE_ASSET_MUTATION)

  const [draft, setDraft] = useState<AssetCreateDraft>(initialDraft)
  const quoteState = useAssetQuote()
  const { clearQuote, verifyTicker } = quoteState
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSecurity = draft.assetType === 'SECURITY'
  const classifierLocked = draft.assetType === 'CURRENCY'
  const availableClassifiers = CLASSIFIER_OPTIONS[draft.assetType]
  const { forcedUsdPriceValue, isForcedUsdPriceValid, isTrackingMultiplierValid, trackingMultiplierValue } = getAssetPriceValidation(draft.trackingMultiplier, draft.forcedUsdPrice)
  const tracking = securityTrackingControls({ canEdit, draft, quoteState, updateDraft })
  const canSave = canEdit
    && !isSaving
    && draft.identifier.trim() !== ''
    && (!isSecurity || (
      !tracking.trackingTickerError
      && (!draft.customTracking || isTrackingMultiplierValid)
      && (!draft.forcePrice || isForcedUsdPriceValid)
    ))

  function updateDraft(draftUpdate: Partial<AssetCreateDraft>) {
    setDraft((current) => ({ ...current, ...draftUpdate }))
  }

  function handleAssetTypeChange(assetType: AssetType) {
    setDraft((current) => ({
      ...current,
      assetType,
      classifier: defaultClassifierForAssetType(assetType),
      ...(assetType === 'SECURITY' ? {} : { cusip: '', customTracking: false, forcePrice: false, forcedUsdPrice: '', isin: '', trackingMultiplier: '1', trackingTicker: '' }),
    }))
    clearQuote()
  }

  async function handleVerifyTicker() {
    await verifyTicker(draft.trackingTicker)
  }

  async function save() {
    if (!canSave) return

    setIsSaving(true)
    setError(null)
    const input: CreateAssetInput = {
      assetType: draft.assetType,
      identifier: draft.identifier.trim(),
      classifier: draft.classifier,
    }
    const name = draft.name.trim()
    if (name) input.name = name
    if (isSecurity) {
      if (draft.customTracking) {
        input.trackingTicker = draft.trackingTicker.trim()
        input.trackingMultiplier = trackingMultiplierValue
      }
      if (draft.forcePrice) input.forcedUsdPrice = forcedUsdPriceValue

      const cusip = draft.cusip.trim()
      const isin = draft.isin.trim()
      if (cusip || isin) input.security = { cusip: cusip || null, isin: isin || null }
    }

    const result = await createAsset({ input })
    if (result.error) {
      setError(result.error.message)
      setIsSaving(false)
      return
    }
    const created = result.data?.createAsset?.asset as Asset | undefined
    if (created) onCreate?.(created)
    setIsSaving(false)
    onClose()
  }

  return { ...tracking, availableClassifiers, canEdit, canSave, classifierLocked, draft, error, handleAssetTypeChange, handleVerifyTicker, isSaving, isSecurity, quoteState, save, updateDraft }
}
