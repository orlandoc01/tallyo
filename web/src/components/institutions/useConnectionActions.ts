import { useState } from 'react'
import { useMutation } from 'urql'
import { DELETE_CONNECTION_MUTATION, UPDATE_CONNECTION_MUTATION } from '../../graphql/mutations'
import { usePlaidLink } from '../../hooks/usePlaidLink'
import type { CompleteLinkUpdatePayload, Connection, DeleteConnectionInput, DeleteConnectionPayload, PlaidItem, UpdateConnectionInput, UpdateConnectionPayload } from '../../types/graphql'
import { connectionLabel, connectionNameForPlaidItem } from './connectionLabels'

// Connection maintenance actions (repair login, connect/disconnect, delete)
// with their status/error messaging, shared by the accounts page and the
// connection review queue.
export function useConnectionActions(connections: Connection[], options?: {
  labelFallback?: string
  onDeleted?: (connection: Connection) => void
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [, updateConnection] = useMutation<{ updateConnection: UpdateConnectionPayload }, { input: UpdateConnectionInput }>(UPDATE_CONNECTION_MUTATION)
  const [, deleteConnection] = useMutation<{ deleteConnection: DeleteConnectionPayload }, { input: DeleteConnectionInput }>(DELETE_CONNECTION_MUTATION)
  const { error: linkError, isLoading: isRepairing, startUpdateLink } = usePlaidLink({ onUpdateSuccess: handleLinkUpdateComplete })

  function handleLinkUpdateComplete(payload: CompleteLinkUpdatePayload) {
    const name = connectionNameForPlaidItem(payload.item.id, connections)
    setMessage(payload.item.healthState === 'HEALTHY' ? `${name} was reconnected and synced.` : `${name} still needs attention.`)
  }

  function handleUpdateLogin(item: PlaidItem) {
    setActionError(null)
    setMessage(null)
    startUpdateLink(item.id)
  }

  async function handleConnectionActiveChange(connection: Connection, isActive: boolean) {
    setActionError(null)
    setMessage(null)
    const result = await updateConnection({ input: { connectionId: connection.id, isActive } })
    if (result.error) {
      setActionError(result.error.message)
      return
    }
    const label = connectionLabel(result.data?.updateConnection.connection ?? connection, options?.labelFallback)
    setMessage(`${label} ${isActive ? 'reconnected' : 'disconnected'}.`)
  }

  async function handleDeleteConnection(connection: Connection) {
    setActionError(null)
    setMessage(null)
    const result = await deleteConnection({ input: { connectionId: connection.id } })
    if (result.error) {
      setActionError(result.error.message)
      return
    }
    setMessage('Connection deleted.')
    options?.onDeleted?.(connection)
  }

  return {
    actionError,
    handleConnectionActiveChange,
    handleDeleteConnection,
    handleUpdateLogin,
    isRepairing,
    linkError,
    message,
    setMessage,
  }
}
