import { RefreshCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useMutation, useQuery } from 'urql'
import { DELETE_SIMPLE_FIN_ACCESS_TOKEN_MUTATION, RESET_SIMPLE_FIN_SYNC_MUTATION } from '../../graphql/mutations'
import { CONNECTIONS_QUERY } from '../../graphql/queries'
import { usePermissions } from '../../hooks/usePermissions'
import { useSimpleFinAccessTokens } from '../../hooks/useEntityQueries'
import type { Connection, CreateSimpleFinAccessTokenPayload, SimpleFinAccessToken } from '../../types/graphql'
import { formatScheduleTime } from '../../utils/dates'
import { Button, IconButton } from '../common/Button'
import { EmptyState } from '../common/EmptyState'
import { Card, FormSuccess } from '../common/FormControls'
import { QueryGate } from '../common/QueryGate'
import { ConnectionModal } from '../institutions/ConnectionModal'
import { CollapsibleRowToggle } from './CollapsibleRowToggle'
import { ListCardHeader } from './ListCardHeader'

export function SimpleFinTab() {
  const { canRead, canWrite } = usePermissions()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmDeleteID, setConfirmDeleteID] = useState<string | null>(null)
  const { tokens, fetching, error, refetch } = useSimpleFinAccessTokens(!canRead('settings'))
  const [connectionResult, refetchConnections] = useQuery<{ connections: { items: Connection[] } }>({ query: CONNECTIONS_QUERY, variables: { input: { includeInactive: true } }, pause: !canRead('settings') })
  const [, deleteToken] = useMutation<{ deleteSimpleFinAccessToken: boolean }, { id: string }>(DELETE_SIMPLE_FIN_ACCESS_TOKEN_MUTATION)
  const [, resetSync] = useMutation<{ resetSimpleFinSync: SimpleFinAccessToken }, { id: string }>(RESET_SIMPLE_FIN_SYNC_MUTATION)
  const loading = fetching || connectionResult.fetching
  const combinedError = error || connectionResult.error
  const connections = connectionResult.data?.connections.items ?? []

  if (!canRead('settings')) {
    return <EmptyState title="Settings access required" description="Your account cannot view SimpleFIN settings." />
  }

  function handleCreated(payload: CreateSimpleFinAccessTokenPayload) {
    setMessage(`Created SimpleFIN token with ${payload.connections.length} connection${payload.connections.length === 1 ? '' : 's'}.`)
    setShowCreateModal(false)
    refetch({ requestPolicy: 'network-only' })
    refetchConnections({ requestPolicy: 'network-only' })
  }

  async function handleDelete(token: SimpleFinAccessToken) {
    if (confirmDeleteID !== token.id) {
      setConfirmDeleteID(token.id)
      return
    }
    const result = await deleteToken({ id: token.id })
    if (!result.error) {
      setMessage('SimpleFIN access token deleted.')
      setConfirmDeleteID(null)
      refetch({ requestPolicy: 'network-only' })
      refetchConnections({ requestPolicy: 'network-only' })
    }
  }

  async function handleReset(token: SimpleFinAccessToken) {
    const result = await resetSync({ id: token.id })
    if (!result.error) {
      setMessage('SimpleFIN sync will run a full pull on its next background tick.')
      refetch({ requestPolicy: 'network-only' })
    }
  }

  return (
    <section className="space-y-3">
      {message ? <FormSuccess>{message}</FormSuccess> : null}
      <QueryGate
        empty={tokens.length === 0}
        emptyTitle="No SimpleFIN tokens"
        emptyDescription="Create an access token to link SimpleFIN institutions."
        error={combinedError}
        fetching={loading}
      >
        <Card>
          <ListCardHeader
            actions={canWrite('accounts') ? <Button onClick={() => setShowCreateModal(true)}>+ Create access token</Button> : null}
            description="Claim setup tokens from SimpleFIN Bridge. Access URLs are stored write-only and never displayed."
            title="Access Tokens"
          />
          {tokens.map((token) => {
            const open = expanded === token.id
            const title = token.label?.trim() || `SimpleFIN token ${token.id}`
            return (
              <div className="border-t border-border" key={token.id}>
                <div className="flex min-h-12 items-center gap-2 px-4 py-1.5">
                  <CollapsibleRowToggle open={open} title={title} onToggle={() => setExpanded(open ? null : token.id)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-1">{title}</p>
                    <p className="truncate text-xs text-text-muted">{token.connections.length} connection{token.connections.length === 1 ? '' : 's'} for {token.owner.name} · Next sync: {formatScheduleTime(token.nextSyncAt)}</p>
                  </div>
                  {canWrite('accounts') ? (
                    <div className="flex shrink-0 gap-1.5">
                      <IconButton ariaLabel="Reset sync" onClick={() => void handleReset(token)} size="sm">
                        <RefreshCcw className="h-3.5 w-3.5" />
                      </IconButton>
                      <Button onClick={() => void handleDelete(token)} size="sm" variant="danger">
                        <Trash2 aria-hidden className="h-3.5 w-3.5" />
                        {confirmDeleteID === token.id ? 'Confirm delete' : 'Delete'}
                      </Button>
                    </div>
                  ) : null}
                </div>
                {open ? (
                  <div className="border-t border-border bg-surface-2 py-1 pl-12 pr-4">
                    {token.connections.length === 0 ? <p className="py-2 text-[13px] text-text-muted">No SimpleFIN connections use this token.</p> : null}
                    {token.connections.map((simpleFinConnection) => {
                      const connection = connections.find((item) => item.provider?.__typename === 'SimpleFinConnection' && item.provider.id === simpleFinConnection.id)
                      const name = connection?.name || simpleFinConnection.orgDomain || simpleFinConnection.id
                      return (
                        <div className="flex min-h-10 items-center justify-between gap-3 py-1" key={simpleFinConnection.id}>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-text-1">{name}</p>
                            <p className="truncate text-xs text-text-muted">{connection?.owner.name || token.owner.name}</p>
                          </div>
                          <p className="shrink-0 text-xs text-text-muted">{simpleFinConnection.accounts.length} account{simpleFinConnection.accounts.length === 1 ? '' : 's'}{simpleFinConnection.orgUrl ? ` · ${simpleFinConnection.orgUrl}` : ''}</p>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </Card>
      </QueryGate>

      {showCreateModal ? (
        <ConnectionModal
          initialTab="simplefin"
          onClose={() => setShowCreateModal(false)}
          onPlaidLinked={() => {
            setShowCreateModal(false)
            refetch({ requestPolicy: 'network-only' })
          }}
          onSimpleFinLinked={handleCreated}
        />
      ) : null}
    </section>
  )
}
