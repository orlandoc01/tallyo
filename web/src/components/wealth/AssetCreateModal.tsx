import type { FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { FormError, SelectField, TextField } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { ModalTitleRow } from '../common/ModalHeader'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { Asset } from '../../types/graphql'
import { AssetCreateSheet } from './AssetCreateSheet'
import { AssetInfoFields, AssetSecurityFields } from './AssetFormFields'
import { CREATE_ASSET_TYPES, useAssetCreateForm } from './useAssetCreateForm'

export function AssetCreateModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate?: (asset: Asset) => void
}) {
  const isMobile = useIsMobile()
  const form = useAssetCreateForm({ onClose, onCreate })
  const { availableClassifiers, canEdit, canSave, classifierLocked, draft, error, isSaving, isSecurity, updateDraft } = form

  if (isMobile) return <AssetCreateSheet form={form} onClose={onClose} />

  function handleSave(event: FormEvent) {
    event.preventDefault()
    void form.save()
  }

  return (
    <Modal onClose={onClose} label="Create asset" scrollable>
      <form className="space-y-5" onSubmit={handleSave}>
        <ModalTitleRow onClose={onClose} title="Create Asset" />

        <div className="space-y-4">
          <SelectField disabled={!canEdit} label="Asset Type" onChange={form.handleAssetTypeChange} options={CREATE_ASSET_TYPES} value={draft.assetType} />
          <AssetInfoFields availableClassifiers={availableClassifiers} canEdit={canEdit} classifierLocked={classifierLocked} draft={draft} lockedClassifierNote="always Cash & Equivalents for currency assets" updateDraft={updateDraft} />

          {isSecurity ? (
            <>
              <AssetSecurityFields form={form} />

              <div className="grid gap-3 sm:grid-cols-2">
                <TextField disabled={!canEdit} label="CUSIP" onChange={(cusip) => updateDraft({ cusip })} type="text" value={draft.cusip} />
                <TextField disabled={!canEdit} label="ISIN" onChange={(isin) => updateDraft({ isin })} type="text" value={draft.isin} />
              </div>
            </>
          ) : null}
        </div>

        {error ? <FormError>{error}</FormError> : null}

        {canEdit ? <ModalActions busy={isSaving} busyIcon={<Loader2 className="h-4 w-4 animate-spin" />} disabled={!canSave} onCancel={onClose} submitLabel="Create" /> : null}
      </form>
    </Modal>
  )
}
