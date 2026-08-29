import clsx from 'clsx'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery } from 'urql'
import { DELETE_PLAID_CREDENTIAL_MUTATION, CREATE_PLAID_CREDENTIAL_MUTATION, UPDATE_PLAID_CREDENTIAL_MUTATION } from '../../graphql/mutations'
import { CONNECTIONS_QUERY, PLAID_CREDENTIALS_QUERY } from '../../graphql/queries'
import { usePermissions } from '../../hooks/usePermissions'
import type { Connection, CreatePlaidCredentialInput, DeletePlaidCredentialInput, PlaidCredential, PlaidEnvironment, UpdatePlaidCredentialInput } from '../../types/graphql'
import { Button } from '../common/Button'
import { EmptyState } from '../common/EmptyState'
import { Card, FormError, TextField } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { QueryGate } from '../common/QueryGate'
import { CollapsibleRowToggle } from './CollapsibleRowToggle'

type FormMode = 'create' | 'edit'

const ENVIRONMENTS: PlaidEnvironment[] = ['SANDBOX', 'PRODUCTION']

function getCredentialTitle(credential: PlaidCredential) {
  if (credential.label?.trim()) return credential.label.trim()
  return `${credential.environment.toLowerCase()} credential`
}

export function PlaidTab() {
  const { canRead, canWrite } = usePermissions()
  const [expanded, setExpanded] = useState<number | null>(null)
  const [modal, setModal] = useState<{ mode: FormMode; credential?: PlaidCredential } | null>(null)
  const [credentialResult, refetchCredentials] = useQuery<{ plaidCredentials: { items: PlaidCredential[] } }>({ query: PLAID_CREDENTIALS_QUERY, pause: !canRead('settings') })
  const [connectionResult, refetchConnections] = useQuery<{ connections: { items: Connection[] } }>({ query: CONNECTIONS_QUERY, variables: { input: { includeInactive: true } }, pause: !canRead('settings') })

  if (!canRead('settings')) {
    return <EmptyState title="Settings access required" description="Your account cannot view Plaid settings." />
  }

  const credentials = credentialResult.data?.plaidCredentials.items ?? []
  const connections = connectionResult.data?.connections.items ?? []
  const loading = credentialResult.fetching || connectionResult.fetching
  const error = credentialResult.error || connectionResult.error

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-neutral-950">Credentials</h2>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">Store client credentials for linking accounts. Secrets are write-only and never displayed.</p>
        </div>
        {canWrite('settings') ? (
          <Button className="gap-2" onClick={() => setModal({ mode: 'create' })} type="button">
            <Plus className="h-4 w-4" />
            Store Credentials
          </Button>
        ) : null}
      </div>

      <QueryGate
        data={credentialResult.data && connectionResult.data}
        empty={credentials.length === 0}
        emptyTitle="No Plaid credentials"
        emptyDescription="Store credentials before linking Plaid accounts."
        error={error}
        fetching={loading}
      >
        <Card compact>
          {credentials.map((credential) => {
            const rowItems = connections.filter((connection) => connection.provider?.__typename === 'PlaidItem' && connection.provider.credential.id === credential.id)
            const open = expanded === credential.id
            const title = getCredentialTitle(credential)
            return (
              <div className="border-b border-neutral-100 last:border-b-0" key={credential.id}>
                <div className="flex items-center gap-3 p-4">
                  <CollapsibleRowToggle open={open} title={title} onToggle={() => setExpanded(open ? null : credential.id)} />
                  <button className="min-w-0 flex-1 text-left" disabled={!canWrite('settings')} onClick={() => setModal({ mode: 'edit', credential })} type="button">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-neutral-950">{title}</span>
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-500">{credential.environment.toLowerCase()}</span>
                    </div>
                    <p className="mt-1 text-sm text-neutral-500">{rowItems.length} item{rowItems.length === 1 ? '' : 's'}</p>
                  </button>
                </div>
                {open ? (
                  <div className="space-y-2 border-t border-neutral-100 bg-neutral-50 px-12 py-3">
                    {rowItems.length === 0 ? <p className="text-sm text-neutral-500">No Plaid items use this credential.</p> : null}
                    {rowItems.map((connection) => (
                      <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2" key={connection.id}>
                        <p className="font-mono text-sm text-neutral-800">{connection.provider?.__typename === 'PlaidItem' ? connection.provider.id : connection.id}</p>
                        <p className="text-sm text-neutral-500">{connection.name || 'Unknown institution'}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </Card>
      </QueryGate>

      {modal ? (
        <PlaidCredentialModal
          credential={modal.credential}
          mode={modal.mode}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            refetchCredentials({ requestPolicy: 'network-only' })
            refetchConnections({ requestPolicy: 'network-only' })
          }}
        />
      ) : null}
    </section>
  )
}

function PlaidCredentialModal({ mode, credential, onClose, onSaved }: { mode: FormMode; credential?: PlaidCredential; onClose: () => void; onSaved: () => void }) {
  const [clientId, setClientId] = useState(credential?.clientId ?? '')
  const [secret, setSecret] = useState('')
  const [label, setLabel] = useState(credential?.label ?? '')
  const [environment, setEnvironment] = useState<PlaidEnvironment>(credential?.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [createResult, createCredential] = useMutation<{ createPlaidCredential: { credential: PlaidCredential } }, { input: CreatePlaidCredentialInput }>(CREATE_PLAID_CREDENTIAL_MUTATION)
  const [updateResult, updateCredential] = useMutation<{ updatePlaidCredential: { credential: PlaidCredential } }, { input: UpdatePlaidCredentialInput }>(UPDATE_PLAID_CREDENTIAL_MUTATION)
  const [deleteResult, deleteCredential] = useMutation<{ deletePlaidCredential: { success: boolean } }, { input: DeletePlaidCredentialInput }>(DELETE_PLAID_CREDENTIAL_MUTATION)
  const saving = createResult.fetching || updateResult.fetching || deleteResult.fetching
  const error = createResult.error || updateResult.error || deleteResult.error

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (mode === 'create') {
      const result = await createCredential({ input: { clientId, secret, environment, label: label.trim() || null } })
      if (!result.error) onSaved()
      return
    }
    if (!credential) return
    const result = await updateCredential({ input: { id: credential.id, secret, environment } })
    if (!result.error) onSaved()
  }

  async function handleDelete() {
    if (!credential) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    const result = await deleteCredential({ input: { id: credential.id } })
    if (!result.error) onSaved()
  }

  return (
    <Modal label={mode === 'create' ? 'Store Plaid credentials' : 'Edit Plaid credential'} onClose={onClose}>
      <form className="space-y-5" onSubmit={submit}>
        <div>
          <h3 className="text-lg font-semibold text-neutral-950">{mode === 'create' ? 'Store Credentials' : 'Rotate Credential'}</h3>
          <p className="mt-1 text-sm text-neutral-500">{mode === 'create' ? 'Save a Plaid client ID and secret.' : 'Update the secret or environment. The client ID cannot be changed.'}</p>
        </div>
        <p className="text-xs text-neutral-500"><span aria-hidden="true" className="text-red-500">*</span> Required</p>

        <TextField aria-invalid={!clientId.trim()} disabled={mode === 'edit'} label="Client ID" labelSuffix={<span aria-hidden="true" className="text-red-500"> *</span>} onChange={setClientId} required value={clientId} />
        <TextField aria-invalid={!secret.trim()} label="Client secret" labelSuffix={<span aria-hidden="true" className="text-red-500"> *</span>} onChange={setSecret} required type="password" value={secret} />

        {mode === 'create' ? (
          <TextField label="Label" onChange={setLabel} placeholder="Primary" value={label} />
        ) : null}

        <div className="space-y-2">
          <span className="text-sm font-medium text-neutral-700">Environment</span>
          <div className="grid grid-cols-2 gap-2 rounded-full bg-neutral-100 p-1">
            {ENVIRONMENTS.map((env) => (
              <button className={clsx('rounded-full px-3 py-2 text-sm font-semibold transition', environment === env ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-500 hover:text-neutral-800')} key={env} onClick={() => setEnvironment(env)} type="button">
                {env.toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {error ? <FormError>{error.message}</FormError> : null}

        <div className="flex items-center justify-between gap-3">
          {mode === 'edit' ? (
            <Button disabled={saving} onClick={handleDelete} type="button" variant={confirmDelete ? 'danger-solid' : 'danger'}>
              {confirmDelete ? 'Confirm delete' : 'Delete'}
            </Button>
          ) : <span />}
          <ModalActions busy={saving} className="gap-2" disabled={saving} onCancel={onClose} />
        </div>
      </form>
    </Modal>
  )
}
