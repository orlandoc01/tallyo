import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation } from 'urql'
import { CREATE_SIMPLE_FIN_ACCESS_TOKEN_MUTATION } from '../../graphql/mutations'
import type { CreateSimpleFinAccessTokenInput, CreateSimpleFinAccessTokenPayload } from '../../types/graphql'
import { ErrorState } from '../common/ErrorState'
import { FormError, TextAreaField, TextField } from '../common/FormControls'
import { CenteredSpinner } from '../common/LoadingSpinner'
import { ModalActions } from '../common/Modal'
import { OwnerLoadStatus, OwnerSelectField } from './OwnerSelectField'
import { useLinkOwners } from './useLinkOwners'

export function SimpleFinConnectionForm({
  onClose,
  onLinked,
}: {
  onClose: () => void
  onLinked: (payload: CreateSimpleFinAccessTokenPayload) => void
}) {
  const { owners, ownersFetching, ownersError, canCreateOwner, selectedOwner, setSelectedOwner, handleOwnerCreated } = useLinkOwners()
  const [label, setLabel] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [result, createAccessToken] = useMutation<
    { createSimpleFinAccessToken: CreateSimpleFinAccessTokenPayload },
    { input: CreateSimpleFinAccessTokenInput }
  >(CREATE_SIMPLE_FIN_ACCESS_TOKEN_MUTATION)

  const noOwnersReadOnly = !ownersFetching && !ownersError && owners.length === 0 && !canCreateOwner
  const canSubmit = setupToken.trim() && selectedOwner && !result.fetching && !noOwnersReadOnly

  function handleClose() {
    setSetupToken('')
    setLabel('')
    setSelectedOwner('')
    onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    const mutationResult = await createAccessToken({
      input: {
        setupToken: setupToken.trim(),
        ownerId: selectedOwner,
        label: label.trim() || null,
      },
    })
    const payload = mutationResult.data?.createSimpleFinAccessToken
    if (!mutationResult.error && payload) {
      onLinked(payload)
      handleClose()
    }
  }

  return (
    <form className="mt-6 space-y-5" onSubmit={submit}>
      {result.fetching ? (
        <CenteredSpinner />
      ) : (
        <>
          <OwnerLoadStatus error={ownersError} fetching={ownersFetching} />
          {noOwnersReadOnly ? <ErrorState message="No owners exist. An admin must create an owner before linking SimpleFIN." /> : null}

          <TextAreaField className="space-y-1" controlClassName="font-mono" label="Setup Token" labelClassName="font-semibold text-neutral-950" minHeight="min-h-32" onChange={setSetupToken} placeholder="Paste the base64 setup token from SimpleFIN Bridge" required value={setupToken} />

          <TextField label="Label" onChange={setLabel} placeholder="SimpleFIN Bridge" value={label} />

          <OwnerSelectField
            canCreateOwner={canCreateOwner}
            owners={owners}
            ownersError={ownersError}
            ownersFetching={ownersFetching}
            selectedOwner={selectedOwner}
            setSelectedOwner={setSelectedOwner}
            onOwnerCreated={handleOwnerCreated}
          />

          {result.error ? <FormError>{result.error.message}</FormError> : null}
        </>
      )}

      <ModalActions busy={result.fetching} busyLabel="Linking..." disabled={!canSubmit} onCancel={handleClose} submitLabel="Link" />
    </form>
  )
}
