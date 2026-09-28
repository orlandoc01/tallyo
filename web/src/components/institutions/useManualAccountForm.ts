import { useMemo, useState } from 'react'
import { useMutation } from 'urql'
import { CREATE_MANUAL_ACCOUNT_MUTATION } from '../../graphql/mutations'
import { useOwners } from '../../hooks/useEntityQueries'
import { usePermissions } from '../../hooks/usePermissions'
import { useSaveAction } from '../../hooks/useSaveAction'
import type { AccountType, Owner } from '../../types/graphql'

interface ManualAccountDraft {
  closed: boolean
  hidden: boolean
  name: string
  ownerId: string
  type: AccountType
}

export function useManualAccountForm({ connectionId, onClose, onCreated }: { connectionId: string | null; onClose: () => void; onCreated: () => void }) {
  const { owners: fetchedOwners } = useOwners()
  const { canWrite } = usePermissions()
  const canCreateOwner = canWrite('owners')
  const [, createManualAccount] = useMutation(CREATE_MANUAL_ACCOUNT_MUTATION)
  const [draft, setDraft] = useState<ManualAccountDraft>({ closed: false, hidden: false, name: '', ownerId: '', type: 'DEPOSITORY' })
  const [createdOwners, setCreatedOwners] = useState<Owner[]>([])
  const { error, saving, save: run } = useSaveAction()

  const owners = useMemo(() => [...fetchedOwners, ...createdOwners], [fetchedOwners, createdOwners])
  const effectiveOwnerId = draft.ownerId || owners[0]?.id || ''
  const noOwnersReadOnly = owners.length === 0 && !canCreateOwner
  const canSave = !saving && draft.name.trim() !== '' && effectiveOwnerId !== '' && !noOwnersReadOnly

  const patch = (changes: Partial<ManualAccountDraft>) => setDraft((current) => ({ ...current, ...changes }))

  function handleOwnerCreated(owner: Owner) {
    setCreatedOwners((prev) => [...prev, owner])
    patch({ ownerId: owner.id })
  }

  async function save() {
    if (!canSave) return
    const { closed, hidden, name, type } = draft
    await run(
      () => createManualAccount({ input: { connectionId, name: name.trim(), ownerId: effectiveOwnerId, type, closed, hidden } }),
      () => { onCreated(); onClose() },
    )
  }

  return { canCreateOwner, canSave, draft, effectiveOwnerId, error, handleOwnerCreated, noOwnersReadOnly, owners, patch, save, saving }
}
