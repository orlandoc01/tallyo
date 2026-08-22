import { useMemo, useState, type FormEvent } from 'react'
import { useMutation } from 'urql'
import type { AccountType, Owner } from '../../types/graphql'
import { CREATE_MANUAL_ACCOUNT_MUTATION } from '../../graphql/mutations'
import { useOwners } from '../../hooks/useEntityQueries'
import { usePermissions } from '../../hooks/usePermissions'
import { ACCOUNT_TYPES, formatAccountType } from '../../utils/accountSubtypes'
import { CheckboxField, FieldLabel, FormError, SelectField, TextField } from '../common/FormControls'
import { Modal, ModalActions, ModalFooter } from '../common/Modal'
import { ModalHeader } from '../common/ModalHeader'
import { useSaveAction } from '../../hooks/useSaveAction'
import { OwnerSelect } from './OwnerSelect'

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
  const { owners: fetchedOwners } = useOwners()
  const { canWrite } = usePermissions()
  const canCreateOwner = canWrite('owners')
  const [, createManualAccount] = useMutation(CREATE_MANUAL_ACCOUNT_MUTATION)

  const [name, setName] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [createdOwners, setCreatedOwners] = useState<Owner[]>([])
  const [type, setType] = useState<AccountType>('DEPOSITORY')
  const [closed, setClosed] = useState(false)
  const [hidden, setHidden] = useState(false)
  const { error, saving: isSubmitting, save } = useSaveAction()

  const owners = useMemo(() => [...fetchedOwners, ...createdOwners], [fetchedOwners, createdOwners])
  const effectiveOwnerId = ownerId || owners[0]?.id || ''
  const noOwnersReadOnly = owners.length === 0 && !canCreateOwner

  function handleOwnerCreated(owner: Owner) {
    setCreatedOwners((prev) => [...prev, owner])
    setOwnerId(owner.id)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    await save(
      () => createManualAccount({ input: { connectionId, name: name.trim(), ownerId: effectiveOwnerId, type, closed, hidden } }),
      () => { onCreated(); onClose() },
    )
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
          <p className="text-xs text-neutral-500"><span aria-hidden="true" className="text-red-500">*</span> Required</p>
          <TextField aria-invalid={!name.trim()} autoFocus label="Account name" labelSuffix={<span aria-hidden="true" className="text-red-500"> *</span>} onChange={setName} placeholder="e.g. Old Amex Gold" required type="text" value={name} />

          <FieldLabel label="Owner">
            <OwnerSelect
              canCreate={canCreateOwner}
              onChange={setOwnerId}
              onOwnerCreated={handleOwnerCreated}
              owners={owners}
              value={effectiveOwnerId}
            />
          </FieldLabel>

          <SelectField label="Type" onChange={setType} options={ACCOUNT_TYPES.map((t) => ({ label: formatAccountType(t), value: t }))} value={type} />

          <div className="flex gap-6">
            <CheckboxField checked={closed} label="Closed" onChange={setClosed} />
            <CheckboxField checked={hidden} label="Hidden" onChange={setHidden} />
          </div>

          <ModalFooter>
            <ModalActions busy={isSubmitting} busyLabel="Creating…" disabled={isSubmitting || !name.trim() || !effectiveOwnerId || noOwnersReadOnly} onCancel={onClose} submitLabel="Create account" />
          </ModalFooter>
        </form>
    </Modal>
  )
}
