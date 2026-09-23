import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ConnectionReviewRow } from './ConnectionReviewRow'
import { reviewProvider } from './connectionReview'
import { useConnectionActions } from './useConnectionActions'
import { ErrorState } from '../common/ErrorState'
import { Card, FormSuccess } from '../common/FormControls'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { QueryGate } from '../common/QueryGate'
import { useConnections } from '../../hooks/useEntityQueries'
import { useIsMobile } from '../../hooks/useIsMobile'
import { usePermissions } from '../../hooks/usePermissions'

export function ConnectionReviewQueue() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { canWrite } = usePermissions()
  const { items, fetching, error, refetch } = useConnections(true)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const {
    actionError,
    handleConnectionActiveChange,
    handleDeleteConnection,
    handleUpdateLogin,
    isRepairing,
    linkError,
    message,
  } = useConnectionActions(items, { labelFallback: 'Connection' })

  const reviewRows = items.flatMap((connection) => {
    const provider = reviewProvider(connection)
    return provider ? [{ connection, provider }] : []
  })
  const canWriteAccounts = canWrite('accounts')

  return (
    <QueryGate
      data={items.length ? items : undefined}
      empty={reviewRows.length === 0}
      emptyTitle="No connections need review"
      emptyDescription="Plaid connections with sync errors and accounts needing a type review will appear here."
      error={error}
      errorPrefix="Could not load connections needing review"
      fetching={fetching}
      loadingLabel="Loading connections needing review"
      onRetry={() => refetch({ requestPolicy: 'network-only' })}
    >
      <div className="space-y-4">
        {message ? <FormSuccess>{message}</FormSuccess> : null}
        {isRepairing ? <LoadingSpinner label="Opening Plaid Link" /> : null}
        {actionError || linkError ? <ErrorState message={actionError || linkError || 'Could not update connection.'} /> : null}
        <Card>
          {reviewRows.map(({ connection, provider }) => (
            <ConnectionReviewRow
              compact={isMobile}
              confirmingDelete={confirmingDeleteId === connection.id}
              connection={connection}
              key={connection.id}
              onAccountClick={(account) => navigate(`/accounts/${account.id}/info`)}
              onConfirmDelete={() => setConfirmingDeleteId(connection.id)}
              onDelete={canWriteAccounts ? () => handleDeleteConnection(connection) : undefined}
              onDisconnect={canWriteAccounts ? () => handleConnectionActiveChange(connection, false) : undefined}
              onUpdateLogin={canWriteAccounts && provider.__typename === 'PlaidItem' ? () => handleUpdateLogin(provider) : undefined}
              provider={provider}
            />
          ))}
        </Card>
      </div>
    </QueryGate>
  )
}
