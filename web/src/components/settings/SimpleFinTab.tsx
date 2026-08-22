import clsx from 'clsx'
import { Plus, RefreshCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useMutation, useQuery } from 'urql'
import { DELETE_SIMPLE_FIN_ACCESS_TOKEN_MUTATION, RESET_SIMPLE_FIN_SYNC_MUTATION } from '../../graphql/mutations'
import { CONNECTIONS_QUERY } from '../../graphql/queries'
import { usePermissions } from '../../hooks/usePermissions'
import { useSimpleFinAccessTokens } from '../../hooks/useEntityQueries'
import type { Connection, CreateSimpleFinAccessTokenPayload, SimpleFinAccessToken } from '../../types/graphql'
import { Button } from '../common/Button'
import { EmptyState } from '../common/EmptyState'
import { Card, FormSuccess } from '../common/FormControls'
import { QueryGate } from '../common/QueryGate'
import { ConnectionModal } from '../institutions/ConnectionModal'
import { CollapsibleRowToggle } from './CollapsibleRowToggle'

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
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-neutral-950">Access Tokens</h2>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">Claim setup tokens from SimpleFIN Bridge. Access URLs are stored write-only and never displayed.</p>
        </div>
        {canWrite('accounts') ? (
          <Button className="gap-2" onClick={() => setShowCreateModal(true)} type="button">
            <Plus className="h-4 w-4" />
            Create Access Token
          </Button>
        ) : null}
      </div>

      {message ? <FormSuccess>{message}</FormSuccess> : null}
      <QueryGate
        empty={tokens.length === 0}
        emptyTitle="No SimpleFIN tokens"
        emptyDescription="Create an access token to link SimpleFIN institutions."
        error={combinedError}
        fetching={loading}
      >
        <Card compact>
          {tokens.map((token) => {
            const open = expanded === token.id
            const title = token.label?.trim() || `SimpleFIN token ${token.id}`
            return (
              <div className="border-b border-neutral-100 last:border-b-0" key={token.id}>
                <div className="flex items-center gap-3 p-4">
                  <CollapsibleRowToggle open={open} title={title} onToggle={() => setExpanded(open ? null : token.id)} />
                  <div className="min-w-0 flex-1">
                    <span className="truncate font-semibold text-neutral-950">{title}</span>
                    <p className="mt-1 text-sm text-neutral-500">{token.connections.length} connection{token.connections.length === 1 ? '' : 's'} for {token.owner.name}</p>
                    <p className="text-xs text-neutral-500">Next sync: {formatScheduleTime(token.nextSyncAt)}</p>
                  </div>
                  {canWrite('accounts') ? (
                    <div className="flex shrink-0 gap-1">
                      <button className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800" onClick={() => void handleReset(token)} title="Reset sync" type="button">
                        <RefreshCcw className="h-4 w-4" />
                      </button>
                      <button className={clsx('rounded-lg p-2 hover:bg-red-50', confirmDeleteID === token.id ? 'text-red-700' : 'text-neutral-500 hover:text-red-600')} onClick={() => void handleDelete(token)} title={confirmDeleteID === token.id ? 'Confirm delete' : 'Delete'} type="button">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                </div>
                {open ? (
                  <div className="space-y-2 border-t border-neutral-100 bg-neutral-50 px-12 py-3">
                    {token.connections.length === 0 ? <p className="text-sm text-neutral-500">No SimpleFIN connections use this token.</p> : null}
                    {token.connections.map((simpleFinConnection) => {
                      const connection = connections.find((item) => item.provider?.__typename === 'SimpleFinConnection' && item.provider.id === simpleFinConnection.id)
                      const name = connection?.name || simpleFinConnection.orgDomain || simpleFinConnection.id
                      return (
                        <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2" key={simpleFinConnection.id}>
                          <p className="font-semibold text-neutral-800">{name}</p>
                          <p className="text-sm text-neutral-500">{connection?.owner.name || token.owner.name}</p>
                          <p className="text-xs text-neutral-500">{simpleFinConnection.accounts.length} account{simpleFinConnection.accounts.length === 1 ? '' : 's'}{simpleFinConnection.orgUrl ? ` · ${simpleFinConnection.orgUrl}` : ''}</p>
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

function formatScheduleTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : 'not scheduled'
}
