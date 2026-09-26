import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { AccountDetailModal } from '../components/institutions/AccountDetailModal'
import type { AccountDetailTab } from '../components/institutions/AccountDetailSheet'
import { AccountTable } from '../components/institutions/AccountRows'
import { AddAccountModals, type LinkingStep } from '../components/institutions/AddAccountModals'
import { AddManualAccountModal } from '../components/institutions/AddManualAccountModal'
import { InstitutionCard } from '../components/institutions/InstitutionCard'
import { InstitutionCards } from '../components/institutions/InstitutionCards'
import { RealEstateRow } from '../components/institutions/RealEstateRow'
import { SyncSettingsModal } from '../components/institutions/SyncSettingsModal'
import { institutionEntries, searchAccounts, searchInstitutionEntries } from '../components/institutions/accountCards'
import { connectionNameForPlaidItem } from '../components/institutions/connectionLabels'
import { useConnectionActions } from '../components/institutions/useConnectionActions'
import { Button } from '../components/common/Button'
import { EmptyState } from '../components/common/EmptyState'
import { ErrorState } from '../components/common/ErrorState'
import { Card, FormSuccess, SearchInput } from '../components/common/FormControls'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { QueryGate } from '../components/common/QueryGate'
import { useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { amountVisibilityFromParams } from '../hooks/amountVisibilityParam'
import { useAccounts, useConnections } from '../hooks/useEntityQueries'
import { useNormalizeTabParam } from '../hooks/useNormalizeTabParam'
import { usePermissions } from '../hooks/usePermissions'
import { useQueryParamState } from '../hooks/useQueryParamState'
import type { Account, Connection, ConnectionProvider, PlaidItem } from '../types/graphql'

const MANUAL_CARD_TITLE = 'Manual accounts'
const PROVIDER_ORDER: Record<NonNullable<ConnectionProvider['__typename']>, number> = { PlaidItem: 0, SimpleFinConnection: 1, EVMWallet: 2 }

function providerRank(connection: Connection) {
  const typename = connection.provider?.__typename
  return typename ? PROVIDER_ORDER[typename] : Number.MAX_SAFE_INTEGER
}

export function AccountsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { account_id: selectedAccountId, account_tab: selectedAccountTabParam } = useParams()
  const { canWrite } = usePermissions()
  const canWriteAccounts = canWrite('accounts')
  const amountsHidden = amountVisibilityFromParams(searchParams)
  const [search, setSearch] = useQueryParamState('q')
  const { items: connections, fetching, error, refetch } = useConnections(true)
  const { accounts } = useAccounts({ includeLatestSnapshot: true })
  const providerConnections = useMemo(() => (
    connections
      .filter((connection) => connection.provider)
      .sort((left, right) => providerRank(left) - providerRank(right))
  ), [connections])
  const manualAccounts = accounts.filter((account) => account.manual && !account.connection)
  const realEstateAccounts = accounts.filter((account) => account.type === 'PROPERTY' && account.connection)
  const visibleInstitutions = searchInstitutionEntries(search, institutionEntries(providerConnections, accounts))
  const visibleRealEstateAccounts = realEstateAccounts.filter((account) => searchAccounts(search, account.name, [account]) !== null)
  const visibleManualAccounts = searchAccounts(search, MANUAL_CARD_TITLE, manualAccounts) ?? []
  const hasAccounts = providerConnections.length > 0 || realEstateAccounts.length > 0 || manualAccounts.length > 0
  const nothingMatches = hasAccounts && visibleInstitutions.length === 0 && visibleRealEstateAccounts.length === 0 && visibleManualAccounts.length === 0
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
        closeAccount()
      }
    },
  })
  const openAccount = (account: Account) => navigate(accountInfoPath(account.id, location.search))
  const closeAccount = () => navigate(`/accounts${location.search}`)
  const selectedAccountTab: AccountDetailTab = selectedAccountTabParam === 'valuation' ? 'valuation' : 'info'

  const mobileHeaderActions = useMemo(() => {
    if (!canWriteAccounts) return null
    return (
      <Button aria-label="Add account" className="touch-manipulation" onClick={() => setLinkingStep('add-account')}>
        <Plus aria-hidden className="h-4 w-4" />
        Add
      </Button>
    )
  }, [canWriteAccounts])

  useMobileHeaderActions(mobileHeaderActions)

  useNormalizeTabParam(selectedAccountId, selectedAccountTabParam, isAccountDetailTab, (accountId) => accountInfoPath(accountId, location.search))

  const toolbarActions = canWriteAccounts ? (
    <>
      <Button className="hidden lg:inline-flex" onClick={() => setLinkingStep('chooser')} variant="secondary">Link connection</Button>
      <Button aria-label="Link account" className="lg:hidden" onClick={() => setLinkingStep('chooser')} variant="secondary">Link</Button>
      <Button className="hidden lg:inline-flex" onClick={() => setLinkingStep('add-account')}>
        <Plus aria-hidden className="h-4 w-4" />
        Add account
      </Button>
    </>
  ) : null

  return (
    <div className="flex flex-col gap-3">
      <h1 className="sr-only">Accounts</h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput ariaLabel="Search accounts" className="min-w-[200px] flex-1 lg:max-w-[360px]" onChange={setSearch} placeholder="Search accounts..." type="search" value={search} />
        {toolbarActions ? <div className="flex items-center gap-2">{toolbarActions}</div> : null}
      </div>

      {message ? <FormSuccess>{message}</FormSuccess> : null}
      {isRepairing ? <LoadingSpinner label="Opening Plaid Link" /> : null}
      {actionError || linkError ? <ErrorState message={actionError || linkError || 'Could not repair connection.'} /> : null}

      <QueryGate
        data={fetching && connections.length === 0 ? undefined : connections}
        empty={!hasAccounts}
        emptyAction={toolbarActions ? <div className="flex flex-wrap justify-center gap-2">{toolbarActions}</div> : undefined}
        emptyDescription="Add your first account to start syncing transactions."
        emptyTitle="No accounts yet"
        error={error}
        errorPrefix="Could not load connections"
        fetching={fetching}
        loadingLabel="Loading connections"
        onRetry={() => refetch({ requestPolicy: 'network-only' })}
      >
        {nothingMatches ? (
          <EmptyState action={<Button onClick={() => setSearch('')} variant="ghost">Clear search</Button>} description="Try another account name, number or institution." title="No accounts match" />
        ) : null}
        <InstitutionCards
          amountsHidden={amountsHidden}
          items={visibleInstitutions}
          onAccountClick={openAccount}
          onAddManualAccount={canWriteAccounts ? (connectionId, institutionName) => setManualAccountInfo({ connectionId, institutionName }) : undefined}
          onDeleteConnection={canWriteAccounts ? handleDeleteConnection : undefined}
          onDisconnect={canWriteAccounts ? (connection: Connection) => handleConnectionActiveChange(connection, false) : undefined}
          onReconnect={canWriteAccounts ? (connection: Connection) => handleConnectionActiveChange(connection, true) : undefined}
          onSyncSettings={canWriteAccounts ? (connection, item) => setSyncSettingsItem({ connectionId: connection.id, item }) : undefined}
          onUpdateLogin={canWriteAccounts ? handleUpdateLogin : undefined}
        />

        {visibleRealEstateAccounts.map((account) => (
          <Card as="section" key={account.id} overflow="visible">
            <RealEstateRow
              account={account}
              amountsHidden={amountsHidden}
              connectionId={account.connection?.id || ''}
              onClick={openAccount}
              onUnlink={canWriteAccounts ? () => setMessage('Home removed.') : undefined}
              onUpdated={canWriteAccounts ? () => setMessage('Home valuation updated.') : undefined}
              accountWealthProperty={account.accountWealthProperty}
            />
          </Card>
        ))}

        {visibleManualAccounts.length > 0 ? (
          <Card as="section" overflow="visible">
            <InstitutionCard subtitle={`${manualAccounts.length} ${manualAccounts.length === 1 ? 'account' : 'accounts'}`} title={MANUAL_CARD_TITLE}>
              <AccountTable accounts={visibleManualAccounts} amountsHidden={amountsHidden} onAccountClick={openAccount} />
            </InstitutionCard>
          </Card>
        ) : null}
      </QueryGate>

      {selectedAccount ? (
        <AccountDetailModal
          account={selectedAccount}
          activeTab={selectedAccountTab}
          onClose={closeAccount}
          onDelete={() => {
            setMessage('Manual account removed.')
            closeAccount()
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
          onCreated={() => setManualAccountInfo(null)}
        />
      ) : null}
    </div>
  )
}

function accountInfoPath(accountID: string, search: string) {
  return `/accounts/${accountID}/info${search}`
}

function isAccountDetailTab(tab: string | undefined): tab is AccountDetailTab {
  return tab === 'info' || tab === 'valuation'
}
