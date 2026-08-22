import { useState } from 'react'
import { useMutation } from 'urql'
import { LINK_REAL_ESTATE_MUTATION } from '../../graphql/mutations'
import type { LinkRealEstatePayload } from '../../types/graphql'
import { FormError, TextField } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { ModalHeader } from '../common/ModalHeader'
import { useSaveAction } from '../../hooks/useSaveAction'
import { AddressFields } from './AddressFields'
import { emptyAddressDraft, type AddressField } from './addressDraft'
import { OwnerLoadStatus, OwnerSelectField } from './OwnerSelectField'
import { useLinkOwners } from './useLinkOwners'

export function LinkRealEstateModal({
  onClose,
  onLinked,
}: {
  onClose: () => void
  onLinked: (payload: LinkRealEstatePayload) => void
}) {
  const { owners, ownersFetching, ownersError, canCreateOwner, selectedOwner, setSelectedOwner, handleOwnerCreated } = useLinkOwners()
  const [label, setLabel] = useState('')
  const [valuationUSD, setValuationUSD] = useState('')
  const [addressDraft, setAddressDraft] = useState(emptyAddressDraft)
  const { error: submitError, saving: submitting, save, setError: setSubmitError } = useSaveAction()
  const [, linkRealEstate] = useMutation<{ linkRealEstate: LinkRealEstatePayload }>(LINK_REAL_ESTATE_MUTATION)

  function handleAddressChange(field: AddressField, value: string) {
    setAddressDraft((draft) => ({ ...draft, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const value = Number(valuationUSD)
    if (!Number.isFinite(value) || value <= 0) {
      setSubmitError('Enter a positive valuation.')
      return
    }
    if (!selectedOwner) {
      setSubmitError('Select an owner.')
      return
    }
    await save(
      () => linkRealEstate({ input: { street: addressDraft.street || null, city: addressDraft.city || null, state: addressDraft.state || null, zip: addressDraft.zip || null, ownerId: selectedOwner, label: label || null, manualValuationUSD: value } }),
      (result) => { if (result.data?.linkRealEstate) onLinked(result.data.linkRealEstate) },
    )
  }

  return (
    <Modal onClose={onClose} size="lg">
      <ModalHeader onClose={onClose} subtitle="Enter the address and provide a manual valuation for net worth tracking." title="Link home" />

      <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
        <OwnerLoadStatus error={ownersError} fetching={ownersFetching} />

        <AddressFields address={addressDraft} onChange={handleAddressChange} />

        <TextField label="Label" labelSuffix={<span className="text-xs font-normal text-neutral-400"> (optional)</span>} onChange={setLabel} placeholder="e.g. Primary home" type="text" value={label} />
        <TextField inputMode="decimal" label="Manual valuation USD" labelSuffix={<span className="text-red-500"> *</span>} onChange={setValuationUSD} placeholder="850000" required type="number" value={valuationUSD} />

        <OwnerSelectField
          canCreateOwner={canCreateOwner}
          owners={owners}
          ownersError={ownersError}
          ownersFetching={ownersFetching}
          selectedOwner={selectedOwner}
          setSelectedOwner={setSelectedOwner}
          onOwnerCreated={handleOwnerCreated}
        />

        {submitError ? <FormError>{submitError}</FormError> : null}

        <ModalActions busy={submitting} busyLabel="Linking..." className="pt-1" disabled={submitting} onCancel={onClose} submitLabel="Link home" />
      </form>
    </Modal>
  )
}
