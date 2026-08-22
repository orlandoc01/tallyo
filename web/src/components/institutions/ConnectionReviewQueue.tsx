import { useNavigate } from 'react-router'
import { InstitutionList } from './InstitutionList'
import { needsConnectionReview } from './connectionReview'
import { useConnectionActions } from './useConnectionActions'
import { ErrorState } from '../common/ErrorState'
import { FormSuccess } from '../common/FormControls'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { QueryGate } from '../common/QueryGate'
import { useConnections } from '../../hooks/useEntityQueries'
import { usePermissions } from '../../hooks/usePermissions'

export function ConnectionReviewQueue() {
  const navigate = useNavigate()
  const { canWrite } = usePermissions()
  const { items, fetching, error, refetch } = useConnections(true)
  const {
    actionError,
    handleConnectionActiveChange,
    handleDeleteConnection,
    handleUpdateLogin,
    isRepairing,
    linkError,
    message,
  } = useConnectionActions(items, { labelFallback: 'Connection' })

  const reviewConnections = items.filter(needsConnectionReview)
  const canWriteAccounts = canWrite('accounts')

  return (
    <QueryGate
      data={items.length ? items : undefined}
      empty={reviewConnections.length === 0}
      emptyTitle="No connections need review"
      emptyDescription="Plaid connections with sync errors and accounts needing a type review will appear here."
      error={error}
      errorPrefix="Could not load connections needing review"
      fetching={fetching}
      loadingLabel="Loading connections needing review"
      onRetry={() => refetch({ requestPolicy: 'network-only' })}
    >
      <div className="space-y-6">
        {message ? <FormSuccess>{message}</FormSuccess> : null}
        {isRepairing ? <LoadingSpinner label="Opening Plaid Link" /> : null}
        {actionError || linkError ? <ErrorState message={actionError || linkError || 'Could not update connection.'} /> : null}
        <InstitutionList
          items={reviewConnections}
          onAccountClick={(account) => navigate(`/accounts/${account.id}/info`)}
          onUpdateLogin={canWriteAccounts ? handleUpdateLogin : undefined}
          onDisconnect={canWriteAccounts ? (connection) => handleConnectionActiveChange(connection, false) : undefined}
          onReconnect={canWriteAccounts ? (connection) => handleConnectionActiveChange(connection, true) : undefined}
          onDeleteConnection={canWriteAccounts ? handleDeleteConnection : undefined}
        />
      </div>
    </QueryGate>
  )
}
