import { useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery } from 'urql'
import { CONNECTIONS_QUERY, PLAID_CREDENTIALS_QUERY } from '../../graphql/queries'
import { useIsMobile } from '../../hooks/useIsMobile'
import { usePermissions } from '../../hooks/usePermissions'
import type { Connection, PlaidCredential } from '../../types/graphql'
import { Button } from '../common/Button'
import { EmptyState } from '../common/EmptyState'
import { Card, FormError, TextField } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { QueryGate } from '../common/QueryGate'
import { SegmentedControl } from '../common/SegmentedControl'
import { CollapsibleRowToggle } from './CollapsibleRowToggle'
import { ListCardHeader } from './ListCardHeader'
import { PlaidCredentialSheet } from './PlaidCredentialSheet'
import { ENVIRONMENT_OPTIONS, usePlaidCredentialForm, type PlaidCredentialFormMode } from './usePlaidCredentialForm'

function getCredentialTitle(credential: PlaidCredential) {
  if (credential.label?.trim()) return credential.label.trim()
  return `${credential.environment.toLowerCase()} credential`
}

export function PlaidTab() {
  const { canRead, canWrite } = usePermissions()
  const [expanded, setExpanded] = useState<number | null>(null)
  const [modal, setModal] = useState<{ mode: PlaidCredentialFormMode; credential?: PlaidCredential } | null>(null)
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
    <section className="space-y-3">
      <QueryGate
        data={credentialResult.data && connectionResult.data}
        empty={credentials.length === 0}
        emptyTitle="No Plaid credentials"
        emptyDescription="Store credentials before linking Plaid accounts."
        error={error}
        fetching={loading}
      >
        <Card>
          <ListCardHeader
            actions={canWrite('settings') ? <Button onClick={() => setModal({ mode: 'create' })}>+ Store credentials</Button> : null}
            description="Store client credentials for linking accounts. Secrets are write-only and never displayed."
            title="Credentials"
          />
          {credentials.map((credential) => {
            const rowItems = connections.filter((connection) => connection.provider?.__typename === 'PlaidItem' && connection.provider.credential.id === credential.id)
            const open = expanded === credential.id
            const title = getCredentialTitle(credential)
            return (
              <div className="border-t border-border" key={credential.id}>
                <div className="flex h-12 items-center gap-2 px-4">
                  <CollapsibleRowToggle open={open} title={title} onToggle={() => setExpanded(open ? null : credential.id)} />
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" disabled={!canWrite('settings')} onClick={() => setModal({ mode: 'edit', credential })} type="button">
                    <span className="truncate text-sm font-medium text-text-1">{title}</span>
                    <span className="rounded border border-border-strong bg-raised px-1.5 text-[11px] leading-[18px] text-text-2">{credential.environment.toLowerCase()}</span>
                  </button>
                  <span className="shrink-0 text-xs text-text-muted">{rowItems.length} item{rowItems.length === 1 ? '' : 's'}</span>
                </div>
                {open ? (
                  <div className="border-t border-border bg-surface-2 py-1 pl-12 pr-4">
                    {rowItems.length === 0 ? <p className="py-2 text-[13px] text-text-muted">No Plaid items use this credential.</p> : null}
                    {rowItems.map((connection) => (
                      <div className="flex h-10 items-center justify-between gap-3" key={connection.id}>
                        <p className="truncate text-[13px] text-text-2">{connection.name || 'Unknown institution'}</p>
                        <p className="shrink-0 font-mono text-xs text-text-muted">{connection.provider?.__typename === 'PlaidItem' ? connection.provider.id : connection.id}</p>
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

function PlaidCredentialModal({ mode, credential, onClose, onSaved }: { mode: PlaidCredentialFormMode; credential?: PlaidCredential; onClose: () => void; onSaved: () => void }) {
  const isMobile = useIsMobile()
  const form = usePlaidCredentialForm({ credential, mode, onSaved })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { clientId, environment, error, label, saving, secret } = form

  if (isMobile) return <PlaidCredentialSheet form={form} mode={mode} onClose={onClose} />

  function submit(event: FormEvent) {
    event.preventDefault()
    void form.submit()
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    void form.remove()
  }

  return (
    <Modal label={mode === 'create' ? 'Store Plaid credentials' : 'Edit Plaid credential'} onClose={onClose}>
      <form className="space-y-5" onSubmit={submit}>
        <div>
          <h3 className="text-base font-semibold tracking-[-0.2px] text-text-1">{mode === 'create' ? 'Store Credentials' : 'Rotate Credential'}</h3>
          <p className="mt-1 text-[13px] text-text-muted">{mode === 'create' ? 'Save a Plaid client ID and secret.' : 'Update the secret or environment. The client ID cannot be changed.'}</p>
        </div>
        <p className="text-xs text-text-muted"><span aria-hidden="true" className="text-negative">*</span> Required</p>

        <TextField aria-invalid={!clientId.trim()} disabled={mode === 'edit'} label="Client ID" labelSuffix={<span aria-hidden="true" className="text-negative"> *</span>} mono onChange={form.setClientId} required value={clientId} />
        <TextField aria-invalid={!secret.trim()} label="Client secret" labelSuffix={<span aria-hidden="true" className="text-negative"> *</span>} mono onChange={form.setSecret} required type="password" value={secret} />

        {mode === 'create' ? (
          <TextField label="Label" onChange={form.setLabel} placeholder="Primary" value={label} />
        ) : null}

        <div className="space-y-1">
          <span className="block text-xs text-text-muted">Environment</span>
          <SegmentedControl ariaLabel="Environment" onChange={form.setEnvironment} options={ENVIRONMENT_OPTIONS} value={environment} />
        </div>

        {error ? <FormError>{error}</FormError> : null}

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
