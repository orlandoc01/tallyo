import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { useMutation } from 'urql'
import { SelectField, TextField } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { ModalTitleRow } from '../common/ModalHeader'
import { CREATE_ASSET_MUTATION } from '../../graphql/mutations'
import { usePermissions } from '../../hooks/usePermissions'
import type { Asset, AssetClassifier, AssetType, CreateAssetInput } from '../../types/graphql'
import { AssetInfoFields, AssetSecurityFields } from './AssetFormFields'
import { getAssetPriceValidation, getTrackingTickerError } from './assetPriceValidation'
import { CLASSIFIER_OPTIONS, defaultClassifierForAssetType } from './assetFormOptions'
import { useAssetQuote } from './useAssetQuote'

const CREATE_ASSET_TYPES: AssetType[] = ['CURRENCY', 'SECURITY', 'CRYPTO', 'OTHER']

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

export function AssetCreateModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate?: (asset: Asset) => void
}) {
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
  const trackingTickerError = isSecurity ? getTrackingTickerError(draft.customTracking, draft.trackingTicker, draft.identifier) : null
  const canSave = canEdit
    && !isSaving
    && draft.identifier.trim() !== ''
    && (!isSecurity || (
      !trackingTickerError
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

  async function handleSave(event: FormEvent) {
    event.preventDefault()
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

  return (
    <Modal onClose={onClose} label="Create asset" scrollable>
      <form className="space-y-5" onSubmit={handleSave}>
        <ModalTitleRow onClose={onClose} title="Create Asset" />

        <div className="space-y-4">
          <SelectField disabled={!canEdit} label="Asset Type" onChange={handleAssetTypeChange} options={CREATE_ASSET_TYPES} value={draft.assetType} />
          <AssetInfoFields availableClassifiers={availableClassifiers} canEdit={canEdit} classifierLocked={classifierLocked} draft={draft} lockedClassifierNote="always Cash & Equivalents for currency assets" updateDraft={updateDraft} />

          {isSecurity ? (
            <>
              <AssetSecurityFields canEdit={canEdit} draft={draft} onVerify={handleVerifyTicker} quoteState={quoteState} updateDraft={updateDraft} />

              <div className="grid gap-3 sm:grid-cols-2">
                <TextField disabled={!canEdit} label="CUSIP" onChange={(cusip) => updateDraft({ cusip })} type="text" value={draft.cusip} />
                <TextField disabled={!canEdit} label="ISIN" onChange={(isin) => updateDraft({ isin })} type="text" value={draft.isin} />
              </div>
            </>
          ) : null}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {canEdit ? <ModalActions busy={isSaving} busyIcon={<Loader2 className="h-4 w-4 animate-spin" />} disabled={!canSave} onCancel={onClose} submitLabel="Create" /> : null}
      </form>
    </Modal>
  )
}
