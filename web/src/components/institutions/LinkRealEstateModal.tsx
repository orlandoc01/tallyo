import type { FormEvent } from 'react'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { LinkRealEstatePayload } from '../../types/graphql'
import { FormError, TextField } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { ModalHeader } from '../common/ModalHeader'
import { AddressFields } from './AddressFields'
import { LinkRealEstateSheet } from './LinkRealEstateSheet'
import { OwnerLoadStatus, OwnerSelectField } from './OwnerSelectField'
import { useLinkRealEstateForm } from './useLinkRealEstateForm'

export function LinkRealEstateModal({
  onClose,
  onLinked,
}: {
  onClose: () => void
  onLinked: (payload: LinkRealEstatePayload) => void
}) {
  const isMobile = useIsMobile()
  const form = useLinkRealEstateForm({ onLinked })
  const { addressDraft, canCreateOwner, label, owners, ownersError, ownersFetching, selectedOwner, submitError, submitting, valuationUSD } = form

  if (isMobile) return <LinkRealEstateSheet form={form} onClose={onClose} />

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void form.submit()
  }

  return (
    <Modal onClose={onClose} size="lg">
      <ModalHeader onClose={onClose} subtitle="Enter the address and provide a manual valuation for net worth tracking." title="Link home" />

      <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
        <OwnerLoadStatus error={ownersError} fetching={ownersFetching} />

        <AddressFields address={addressDraft} onChange={form.handleAddressChange} />

        <TextField label="Label" labelSuffix={<span className="text-xs font-normal text-text-muted"> (optional)</span>} onChange={form.setLabel} placeholder="e.g. Primary home" type="text" value={label} />
        <TextField inputMode="decimal" label="Manual valuation USD" labelSuffix={<span className="text-negative"> *</span>} onChange={form.setValuationUSD} placeholder="850000" required type="number" value={valuationUSD} />

        <OwnerSelectField
          canCreateOwner={canCreateOwner}
          owners={owners}
          ownersError={ownersError}
          ownersFetching={ownersFetching}
          selectedOwner={selectedOwner}
          setSelectedOwner={form.setSelectedOwner}
          onOwnerCreated={form.handleOwnerCreated}
        />

        {submitError ? <FormError>{submitError}</FormError> : null}

        <ModalActions busy={submitting} busyLabel="Linking..." className="pt-1" disabled={submitting} onCancel={onClose} submitLabel="Link home" />
      </form>
    </Modal>
  )
}
