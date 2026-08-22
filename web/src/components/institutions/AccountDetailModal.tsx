import { useState } from 'react'
import { useQuery } from 'urql'
import type { Account } from '../../types/graphql'
import { ACCOUNT_QUERY } from '../../graphql/queries'
import { accountMaskedName } from '../../utils/accounts'
import { formatDisplayDate } from '../../utils/dates'
import { Modal } from '../common/Modal'
import { ModalCloseButton } from '../common/ModalHeader'
import { FormError } from '../common/FormControls'
import { SegmentedNavTabs } from '../common/SegmentedNavTabs'
import { usePermissions } from '../../hooks/usePermissions'
import { AccountInfoForm } from './AccountInfoForm'
import { AccountSnapshotEditor } from './AccountSnapshotEditor'

export type AccountDetailTab = 'info' | 'valuation'

export function AccountDetailModal({
  account: initialAccount,
  activeTab = 'info',
  basePath: providedBasePath,
  tabSearch = '',
  onClose,
  onUpdate,
  onDelete,
}: {
  account: Account
  activeTab?: AccountDetailTab
  basePath?: string
  tabSearch?: string
  onClose: () => void
  onUpdate?: (account: Account) => void
  onDelete?: (account: Account) => void
}) {
  const { canRead } = usePermissions()
  const canReadValuation = canRead('wealth') && canRead('holdings')
  const [account, setAccount] = useState(initialAccount)
  const [error, setError] = useState<string | null>(null)
  const needsEVMProvider = account.type === 'CRYPTO_WALLET' && !!account.connection && account.connection.provider?.__typename !== 'EVMWallet'
  const [providerResult] = useQuery<{ account: Account }, { id: string }>({
    query: ACCOUNT_QUERY,
    variables: { id: account.id },
    pause: !needsEVMProvider,
  })

  function handleAccountUpdate(updated: Account) {
    setAccount(updated)
    onUpdate?.(updated)
  }

  const displayName = accountMaskedName(account)
  const formErrorId = error ? 'account-detail-error' : undefined
  const basePath = providedBasePath ?? `/accounts/${account.id}`
  const currentTab = activeTab === 'valuation' && !canReadValuation ? 'info' : activeTab
  const providerConnection = providerResult.data?.account.connection
  const accountForForm = providerConnection && account.connection
    ? { ...account, connection: { ...account.connection, ...providerConnection } }
    : account
  const loadingEVMProvider = needsEVMProvider && providerResult.fetching
  const evmProviderError = needsEVMProvider ? providerResult.error : null

  return (
    <Modal className="flex h-[calc(100vh-5rem)] max-h-[48rem] flex-col" label={`Details for ${displayName}`} onClose={onClose} scrollable size="lg">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-xl font-bold text-neutral-950">{displayName}</h2>
        <ModalCloseButton label={`Close details for ${displayName}`} onClick={onClose} />
      </div>

      {error ? <FormError className="mt-5 font-semibold" id={formErrorId}>{error}</FormError> : null}

      <dl className="mt-4 space-y-2 text-sm">
        {account.manual ? (
          <div className="flex justify-between">
            <dt className="text-neutral-500">Source</dt>
            <dd><span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">Manual</span></dd>
          </div>
        ) : null}
        {account.typeLocked ? null : (
          <div className="flex justify-between">
            <dt className="text-neutral-500">Institution</dt>
            <dd className="font-medium">{institutionName(account)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-neutral-500">Created</dt>
          <dd className="font-medium">{formatDisplayDate(account.createdAt.slice(0, 10))}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-neutral-500">Updated</dt>
          <dd className="font-medium">{formatDisplayDate(account.updatedAt.slice(0, 10))}</dd>
        </div>
      </dl>

      <SegmentedNavTabs
        ariaLabel="Account detail sections"
        className="mt-5"
        items={canReadValuation
          ? [
            { to: `${basePath}/info${tabSearch}`, children: 'Info' },
            { to: `${basePath}/valuation${tabSearch}`, children: 'Valuation' },
          ]
          : [{ to: `${basePath}/info${tabSearch}`, children: 'Info' }]}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {currentTab === 'info' && loadingEVMProvider ? (
          <p className="mt-4 text-sm text-neutral-500" role="status">Loading wallet chains…</p>
        ) : null}

        {currentTab === 'info' && evmProviderError ? (
          <FormError className="mt-5 font-semibold">Could not load wallet chains.</FormError>
        ) : null}

        {currentTab === 'info' && !loadingEVMProvider && !evmProviderError ? (
          <AccountInfoForm
            account={accountForForm}
            formErrorId={formErrorId}
            onAccountUpdate={handleAccountUpdate}
            onClose={onClose}
            onDelete={onDelete}
            onError={setError}
          />
        ) : null}

        {currentTab === 'valuation' && canReadValuation ? (
          <AccountSnapshotEditor key={`${account.id}:${account.latestSnapshot?.date ?? ''}`} account={account} onAccountUpdate={handleAccountUpdate} />
        ) : null}
      </div>
    </Modal>
  )
}

function institutionName(account: Account) {
  if (account.manual && !account.connection) {
    return 'Manual'
  }
  if (account.connection?.name) {
    return account.connection.name
  }
  return 'Unknown'
}
