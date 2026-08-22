import { useMemo, useState } from 'react'
import { LinkIcon, Plus } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { AccountDetailModal, type AccountDetailTab } from '../components/institutions/AccountDetailModal'
import { AddAccountModals, type LinkingStep } from '../components/institutions/AddAccountModals'
import { AddManualAccountModal } from '../components/institutions/AddManualAccountModal'
import { InstitutionList } from '../components/institutions/InstitutionList'
import { ManualAccountRow } from '../components/institutions/ManualAccountRow'
import { RealEstateRow } from '../components/institutions/RealEstateRow'
import { SyncSettingsModal } from '../components/institutions/SyncSettingsModal'
import { connectionNameForPlaidItem } from '../components/institutions/connectionLabels'
import { useConnectionActions } from '../components/institutions/useConnectionActions'
import { Button } from '../components/common/Button'
import { EmptyState } from '../components/common/EmptyState'
import { ErrorState } from '../components/common/ErrorState'
import { Card, FormSuccess } from '../components/common/FormControls'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { mobileHeaderActionClass } from '../components/common/mobileHeaderActionClass'
import { useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { useAccounts, useConnections } from '../hooks/useEntityQueries'
import { useNormalizeTabParam } from '../hooks/useNormalizeTabParam'
import { usePermissions } from '../hooks/usePermissions'
import type { Account, Connection, PlaidItem } from '../types/graphql'

export function AccountsPage() {
  const navigate = useNavigate()
  const { account_id: selectedAccountId, account_tab: selectedAccountTabParam } = useParams()
  const { canWrite } = usePermissions()
  const canWriteAccounts = canWrite('accounts')
  const { items: connections, fetching, error, refetch } = useConnections(true)
  const { accounts } = useAccounts({ includeLatestSnapshot: true })
  const plaidConnections = connections.filter((connection) => connection.provider?.__typename === 'PlaidItem')
  const simpleFinConnections = connections.filter((connection) => connection.provider?.__typename === 'SimpleFinConnection')
  const evmConnections = connections.filter((connection) => connection.provider?.__typename === 'EVMWallet')
  const manualAccounts = accounts.filter((account) => account.manual && !account.connection)
  const realEstateAccounts = accounts.filter((account) => account.type === 'PROPERTY' && account.connection)
  const [linkingStep, setLinkingStep] = useState<LinkingStep>(null)
  const [manualAccountInfo, setManualAccountInfo] = useState<{ connectionId: string | null; institutionName: string } | null>(null)
  const [syncSettingsItem, setSyncSettingsItem] = useState<{ connectionId: string; item: PlaidItem } | null>(null)
  const selectedAccount = selectedAccountId ? accounts.find((account) => account.id === selectedAccountId) ?? null : null
  const {
    actionError,
    handleConnectionActiveChange,
    handleDeleteConnection,
    handleUpdateLogin,
    isRepairing,
    linkError,
    message,
    setMessage,
  } = useConnectionActions(connections, {
    onDeleted(connection) {
      const deletedAccountIds = accounts.filter((account) => account.connection?.id === connection.id).map((account) => account.id)
      if (selectedAccountId && deletedAccountIds.includes(selectedAccountId)) {
        navigate('/accounts')
      }
    },
  })
  const openAccount = (account: Account) => navigate(accountInfoPath(account.id))
  const addManualAccount = canWriteAccounts ? (connectionId: string, institutionName: string) => setManualAccountInfo({ connectionId, institutionName }) : undefined
  const disconnectConnection = canWriteAccounts ? (connection: Connection) => handleConnectionActiveChange(connection, false) : undefined
  const reconnectConnection = canWriteAccounts ? (connection: Connection) => handleConnectionActiveChange(connection, true) : undefined
  const deleteConnection = canWriteAccounts ? handleDeleteConnection : undefined
  const institutionProps = {
    accounts,
    onAccountClick: openAccount,
    onAddManualAccount: addManualAccount,
    onDeleteConnection: deleteConnection,
    onDisconnect: disconnectConnection,
    onReconnect: reconnectConnection,
  }
  const selectedAccountTab: AccountDetailTab = selectedAccountTabParam === 'valuation' ? 'valuation' : 'info'

  const mobileHeaderActions = useMemo(() => {
    if (!canWriteAccounts) return null
    return (
      <div className="flex items-center gap-2">
        <button
          aria-label="Link account"
          className={mobileHeaderActionClass('rounded-xl px-4 py-2 text-sm font-semibold', linkingStep === 'chooser' || linkingStep === 'bank' || linkingStep === 'evm')}
          onClick={() => setLinkingStep('chooser')}
          type="button"
        >
          <LinkIcon className="h-5 w-5" />
        </button>
        <button
          aria-label="Add account"
          className={mobileHeaderActionClass('rounded-xl px-4 py-2 text-lg font-semibold leading-none', linkingStep === 'add-account' || linkingStep === 'realestate' || manualAccountInfo !== null)}
          onClick={() => setLinkingStep('add-account')}
          type="button"
        >
          +
        </button>
      </div>
    )
  }, [canWriteAccounts, linkingStep, manualAccountInfo])

  useMobileHeaderActions(mobileHeaderActions)

  useNormalizeTabParam(selectedAccountId, selectedAccountTabParam, isAccountDetailTab, accountInfoPath)

  return (
    <div className="space-y-6">
      {canWriteAccounts ? (
        <div className="hidden justify-end gap-3 lg:flex">
          <Button className="gap-2" onClick={() => setLinkingStep('chooser')} type="button">
            <Plus className="h-4 w-4" />
            Link Connection
          </Button>
          <Button className="gap-2" onClick={() => setLinkingStep('add-account')} type="button">
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      ) : null}

      {message ? <FormSuccess>{message}</FormSuccess> : null}
      {isRepairing ? <LoadingSpinner label="Opening Plaid Link" /> : null}
      {actionError || linkError ? <ErrorState message={actionError || linkError || 'Could not repair connection.'} /> : null}
      {fetching ? <LoadingSpinner label="Loading connections" /> : null}
      {error ? <ErrorState message="Could not load connections." onRetry={() => refetch({ requestPolicy: 'network-only' })} /> : null}
      {!fetching && !error && plaidConnections.length === 0 && simpleFinConnections.length === 0 && evmConnections.length === 0 && realEstateAccounts.length === 0 && manualAccounts.length === 0 ? <EmptyState title="No accounts" description="Add your first account to start syncing transactions." /> : null}
      {plaidConnections.length > 0 ? (
        <InstitutionList
          {...institutionProps}
          items={plaidConnections}
          onUpdateLogin={canWriteAccounts ? handleUpdateLogin : undefined}
          onSyncSettings={canWriteAccounts ? (connection, item) => setSyncSettingsItem({ connectionId: connection.id, item }) : undefined}
        />
      ) : null}

      {simpleFinConnections.length > 0 ? (
        <InstitutionList
          {...institutionProps}
          items={simpleFinConnections}
        />
      ) : null}

      {evmConnections.length > 0 ? (
        <InstitutionList
          {...institutionProps}
          items={evmConnections}
        />
      ) : null}

      {realEstateAccounts.map((account) => (
        <Card as="section" key={account.id} overflow="visible">
          <RealEstateRow
            account={account}
            connectionId={account.connection?.id || ''}
            onClick={(selectedAccount) => navigate(accountInfoPath(selectedAccount.id))}
            onUnlink={canWriteAccounts ? () => setMessage('Home removed.') : undefined}
            onUpdated={canWriteAccounts ? () => setMessage('Home valuation updated.') : undefined}
            accountWealthProperty={account.accountWealthProperty}
          />
        </Card>
      ))}

      {manualAccounts.map((account) => (
        <ManualAccountRow account={account} key={account.id} onClick={(selectedAccount) => navigate(accountInfoPath(selectedAccount.id))} />
      ))}

      {selectedAccount ? (
        <AccountDetailModal
          account={selectedAccount}
          activeTab={selectedAccountTab}
          onClose={() => navigate('/accounts')}
          onDelete={() => {
            setMessage('Manual account removed.')
            navigate('/accounts')
          }}
        />
      ) : null}

      <AddAccountModals
        step={linkingStep}
        onManualAccount={() => setManualAccountInfo({ connectionId: null, institutionName: 'Manual' })}
        onMessage={setMessage}
        onStepChange={setLinkingStep}
      />

      {syncSettingsItem ? (
        <SyncSettingsModal
          connectionId={syncSettingsItem.connectionId}
          item={syncSettingsItem.item}
          name={connectionNameForPlaidItem(syncSettingsItem.item.id, connections)}
          onClose={() => setSyncSettingsItem(null)}
          onUpdated={(item) => {
            setSyncSettingsItem(null)
            setMessage(`Updated sync settings for ${connectionNameForPlaidItem(item.id, connections).toLowerCase()}.`)
          }}
        />
      ) : null}

      {manualAccountInfo !== null ? (
        <AddManualAccountModal
          connectionId={manualAccountInfo.connectionId}
          institutionName={manualAccountInfo.institutionName}
          onClose={() => setManualAccountInfo(null)}
          onCreated={() => {
            setManualAccountInfo(null)
          }}
        />
      ) : null}
    </div>
  )
}

function accountInfoPath(accountID: string) {
  return `/accounts/${accountID}/info`
}

function isAccountDetailTab(tab: string | undefined): tab is AccountDetailTab {
  return tab === 'info' || tab === 'valuation'
}
