import { useState } from 'react'
import { useMutation } from 'urql'
import { CREATE_PLAID_CREDENTIAL_MUTATION, DELETE_PLAID_CREDENTIAL_MUTATION, UPDATE_PLAID_CREDENTIAL_MUTATION } from '../../graphql/mutations'
import type { CreatePlaidCredentialInput, DeletePlaidCredentialInput, PlaidCredential, PlaidEnvironment, UpdatePlaidCredentialInput } from '../../types/graphql'

export type PlaidCredentialFormMode = 'create' | 'edit'

export const ENVIRONMENT_OPTIONS = [
  { value: 'SANDBOX', label: 'sandbox' },
  { value: 'PRODUCTION', label: 'production' },
] as const satisfies ReadonlyArray<{ value: PlaidEnvironment; label: string }>

export function usePlaidCredentialForm({ credential, mode, onSaved }: { credential?: PlaidCredential; mode: PlaidCredentialFormMode; onSaved: () => void }) {
  const [clientId, setClientId] = useState(credential?.clientId ?? '')
  const [secret, setSecret] = useState('')
  const [label, setLabel] = useState(credential?.label ?? '')
  const [environment, setEnvironment] = useState<PlaidEnvironment>(credential?.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX')
  const [createResult, createCredential] = useMutation<{ createPlaidCredential: { credential: PlaidCredential } }, { input: CreatePlaidCredentialInput }>(CREATE_PLAID_CREDENTIAL_MUTATION)
  const [updateResult, updateCredential] = useMutation<{ updatePlaidCredential: { credential: PlaidCredential } }, { input: UpdatePlaidCredentialInput }>(UPDATE_PLAID_CREDENTIAL_MUTATION)
  const [deleteResult, deleteCredential] = useMutation<{ deletePlaidCredential: { success: boolean } }, { input: DeletePlaidCredentialInput }>(DELETE_PLAID_CREDENTIAL_MUTATION)
  const deleting = deleteResult.fetching
  const saving = createResult.fetching || updateResult.fetching || deleting
  const error = createResult.error?.message ?? updateResult.error?.message ?? deleteResult.error?.message ?? null

  async function submit() {
    if (mode === 'create') {
      const result = await createCredential({ input: { clientId, secret, environment, label: label.trim() || null } })
      if (!result.error) onSaved()
      return
    }
    if (!credential) return
    const result = await updateCredential({ input: { id: credential.id, secret, environment } })
    if (!result.error) onSaved()
  }

  async function remove() {
    if (!credential) return
    const result = await deleteCredential({ input: { id: credential.id } })
    if (!result.error) onSaved()
  }

  return { clientId, deleting, environment, error, label, remove, saving, secret, setClientId, setEnvironment, setLabel, setSecret, submit }
}
