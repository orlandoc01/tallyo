import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { usePlaidCredentials } from '../../hooks/useEntityQueries'
import { usePlaidLink } from '../../hooks/usePlaidLink'
import type { ExchangePublicTokenPayload, PlaidCredential } from '../../types/graphql'
import { Button } from '../common/Button'
import { ErrorState } from '../common/ErrorState'
import { FormError } from '../common/FormControls'
import { CenteredSpinner, LoadingSpinner } from '../common/LoadingSpinner'
import { CredentialPicker } from './CredentialPicker'
import { OwnerSelectField } from './OwnerSelectField'
import { useLinkOwners } from './useLinkOwners'

export function PlaidConnectionForm({
  onClose,
  onLinked,
}: {
  onClose: () => void
  onLinked: (payload: ExchangePublicTokenPayload) => void
}) {
  const { credentials, fetching: credentialsFetching, error: credentialsError } = usePlaidCredentials()
  const { owners, ownersFetching, ownersError, canCreateOwner, selectedOwner, setSelectedOwner, handleOwnerCreated } = useLinkOwners()
  const [selectedCredential, setSelectedCredential] = useState<PlaidCredential | null>(null)
  const { error: linkError, isLoading, reset, startLink } = usePlaidLink({
    onSuccess(payload) {
      onLinked(payload)
      handleClose()
    },
  })

  useEffect(() => {
    setSelectedCredential((current) => {
      if (credentials.length === 1) return current?.id === credentials[0].id ? current : credentials[0]
      if (current && !credentials.some((credential) => credential.id === current.id)) return null
      return current
    })
  }, [credentials])

  const isFetching = credentialsFetching || ownersFetching
  const error = credentialsError || ownersError
  const canStart = selectedCredential && selectedOwner && !isLoading
  const noPlaidCredentials = !credentialsFetching && !credentialsError && credentials.length === 0
  const noOwnersReadOnly = !isFetching && !error && owners.length === 0 && !canCreateOwner

  function handleClose() {
    reset()
    setSelectedCredential(null)
    setSelectedOwner('')
    onClose()
  }

  return (
    <>
      {isLoading ? (
        <CenteredSpinner />
      ) : noPlaidCredentials ? (
        <div className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
          Please configure a Plaid Credential in{' '}
          <Link className="font-semibold text-brand-600 hover:text-brand-800" to="/settings/connections?provider=plaid">
            settings
          </Link>
          .
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          {isFetching ? <LoadingSpinner label="Loading link options" /> : null}
          {error ? <ErrorState message="Could not load Plaid credentials or owners." /> : null}
          {noOwnersReadOnly ? <ErrorState message="No owners exist. An admin must create an owner before linking an account." /> : null}

          {!isFetching && !error && credentials.length > 1 ? (
            <CredentialPicker credentials={credentials} onSelect={setSelectedCredential} selectedId={selectedCredential?.id} />
          ) : null}

          {!isFetching && !error && credentials.length === 1 ? (
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
              Using {credentials[0].label || credentials[0].clientId} for this connection.
            </div>
          ) : null}

          {!credentialsFetching && !credentialsError ? (
            <OwnerSelectField
              canCreateOwner={canCreateOwner}
              owners={owners}
              ownersError={ownersError}
              ownersFetching={ownersFetching}
              selectedOwner={selectedOwner}
              setSelectedOwner={setSelectedOwner}
              onOwnerCreated={handleOwnerCreated}
            />
          ) : null}

          {linkError ? <FormError>{linkError}</FormError> : null}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <Button onClick={handleClose} type="button" variant="secondary">Cancel</Button>
        {noPlaidCredentials ? null : (
          <Button disabled={!canStart || noOwnersReadOnly} onClick={() => selectedCredential && startLink(selectedCredential.id, selectedOwner)} type="button">
            {isLoading ? 'Opening Plaid...' : 'Continue to Plaid'}
          </Button>
        )}
      </div>
    </>
  )
}
