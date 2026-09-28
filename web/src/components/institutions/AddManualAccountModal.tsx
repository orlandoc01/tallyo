import type { FormEvent } from 'react'
import { useIsMobile } from '../../hooks/useIsMobile'
import { ACCOUNT_TYPES, formatAccountType } from '../../utils/accountSubtypes'
import { CheckboxField, FieldLabel, FormError, SelectField, TextField } from '../common/FormControls'
import { Modal, ModalActions, ModalFooter } from '../common/Modal'
import { ModalHeader } from '../common/ModalHeader'
import { AddManualAccountSheet } from './AddManualAccountSheet'
import { OwnerSelect } from './OwnerSelect'
import { useManualAccountForm } from './useManualAccountForm'

export function AddManualAccountModal({
  connectionId,
  institutionName,
  onClose,
  onCreated,
}: {
  connectionId: string | null
  institutionName: string
  onClose: () => void
  onCreated: () => void
}) {
  const isMobile = useIsMobile()
  const form = useManualAccountForm({ connectionId, onClose, onCreated })
  const { canCreateOwner, canSave, draft, effectiveOwnerId, error, noOwnersReadOnly, owners, patch, saving } = form

  if (isMobile) return <AddManualAccountSheet form={form} institutionName={institutionName} onClose={onClose} />

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void form.save()
  }

  return (
    <Modal label="Add manual account" onClose={onClose}>
        <ModalHeader onClose={onClose} subtitle={`Under ${institutionName}`} title="Add manual account" />

        {error ? <FormError className="mt-5 font-semibold">{error}</FormError> : null}
        {noOwnersReadOnly ? (
          <FormError className="mt-5 font-semibold">
            No owners exist. An admin must create an owner before adding an account.
          </FormError>
        ) : null}

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <p className="text-xs text-text-3"><span aria-hidden="true" className="text-negative">*</span> Required</p>
          <TextField aria-invalid={!draft.name.trim()} autoFocus label="Account name" labelSuffix={<span aria-hidden="true" className="text-negative"> *</span>} onChange={(name) => patch({ name })} placeholder="e.g. Old Amex Gold" required type="text" value={draft.name} />

          <FieldLabel label="Owner">
            <OwnerSelect
              canCreate={canCreateOwner}
              onChange={(ownerId) => patch({ ownerId })}
              onOwnerCreated={form.handleOwnerCreated}
              owners={owners}
              value={effectiveOwnerId}
            />
          </FieldLabel>

          <SelectField label="Type" onChange={(type) => patch({ type })} options={ACCOUNT_TYPES.map((t) => ({ label: formatAccountType(t), value: t }))} value={draft.type} />

          <div className="flex gap-6">
            <CheckboxField checked={draft.closed} label="Closed" onChange={(closed) => patch({ closed })} />
            <CheckboxField checked={draft.hidden} label="Hidden" onChange={(hidden) => patch({ hidden })} />
          </div>

          <ModalFooter>
            <ModalActions busy={saving} busyLabel="Creating…" disabled={!canSave} onCancel={onClose} submitLabel="Create account" />
          </ModalFooter>
        </form>
    </Modal>
  )
}
