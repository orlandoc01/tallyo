import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { Account, Connection, PlaidItem, SimpleFinConnection } from '../../types/graphql'
import { formatDisplayDate, formatScheduleTime } from '../../utils/dates'
import { syncChipStatus } from './accountCards'
import { AccountTable } from './AccountRows'
import { ActionMenuItem } from '../common/ActionMenuItem'
import { healthMessage } from './connectionReview'
import { InstitutionCard, ProviderChip } from './InstitutionCard'
import { RowActionsMenu } from '../common/RowActionsMenu'

export type InstitutionRowActions = {
  onAccountClick: (account: Account) => void
  onUpdateLogin?: (item: PlaidItem) => void
  onSyncSettings?: (connection: Connection, item: PlaidItem) => void
  onAddManualAccount?: (connectionId: string, institutionName: string) => void
  onDisconnect?: (connection: Connection) => void
  onReconnect?: (connection: Connection) => void
  onDelete?: (connection: Connection) => void
}

export function InstitutionRow({
  connection,
  plaidItem,
  simpleFinConnection,
  accounts,
  amountsHidden = false,
  onAccountClick,
  onUpdateLogin,
  onSyncSettings,
  onAddManualAccount,
  onDisconnect,
  onReconnect,
  onDelete,
}: {
  connection: Connection
  plaidItem?: PlaidItem
  simpleFinConnection?: SimpleFinConnection
  accounts: Account[]
  amountsHidden?: boolean
} & InstitutionRowActions) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const provider = plaidItem ?? simpleFinConnection
  if (!provider) return null

  const name = connection.name || 'Unknown Institution'
  const isActive = connection.isActive
  const sync = syncChipStatus(isActive, provider.lastSyncedAt)
  const count = provider.accounts.length
  const credentialLabel = plaidItem ? plaidItem.credential.label || plaidItem.credential.clientId : 'SimpleFIN Bridge'
  const hasActions = Boolean(onUpdateLogin || onSyncSettings || onAddManualAccount || onDisconnect || onReconnect || onDelete)

  function toggleMenu() {
    setConfirmingDelete(false)
    setIsMenuOpen((open) => !open)
  }

  return (
    <InstitutionCard
      chips={(
        <>
          <ProviderChip tone={sync.tone}>
            <span>{plaidItem ? 'Plaid' : 'SimpleFIN'}</span>
            <span aria-hidden>·</span>
            <span>{sync.text}</span>
          </ProviderChip>
          {isActive && plaidItem ? <span className="whitespace-nowrap">Next sync {formatScheduleTime(plaidItem.nextSyncAt)}</span> : null}
          {isActive && simpleFinConnection?.orgUrl ? <span className="truncate">{simpleFinConnection.orgUrl}</span> : null}
          {isActive && plaidItem ? <HealthChip item={plaidItem} /> : null}
        </>
      )}
      menu={hasActions ? (
        <RowActionsMenu ariaLabel={`Open actions for ${name}`} isOpen={isMenuOpen} onToggle={toggleMenu}>
          {isActive && plaidItem && onUpdateLogin ? <ActionMenuItem onClick={() => { setIsMenuOpen(false); onUpdateLogin(plaidItem) }}>Update login</ActionMenuItem> : null}
          {isActive && plaidItem && onSyncSettings ? <ActionMenuItem onClick={() => { setIsMenuOpen(false); onSyncSettings(connection, plaidItem) }}>Sync settings</ActionMenuItem> : null}
          {isActive && onAddManualAccount ? <ActionMenuItem onClick={() => { setIsMenuOpen(false); onAddManualAccount(connection.id, name) }}>Add manual account</ActionMenuItem> : null}
          {isActive && onDisconnect ? <ActionMenuItem onClick={() => { setIsMenuOpen(false); onDisconnect(connection) }}>Disconnect</ActionMenuItem> : null}
          {!isActive && onReconnect ? <ActionMenuItem onClick={() => { setIsMenuOpen(false); onReconnect(connection) }}>Reconnect</ActionMenuItem> : null}
          {onDelete ? (
            <ActionMenuItem destructive onClick={() => {
              if (!confirmingDelete) {
                setConfirmingDelete(true)
                return
              }
              setIsMenuOpen(false)
              setConfirmingDelete(false)
              onDelete(connection)
            }}>
              {confirmingDelete ? 'Confirm delete' : 'Delete'}
            </ActionMenuItem>
          ) : null}
        </RowActionsMenu>
      ) : undefined}
      subtitle={`${count} ${count === 1 ? 'account' : 'accounts'} · ${credentialLabel} · Connected ${formatDisplayDate(provider.createdAt.slice(0, 10))} by ${connection.owner.name}`}
      title={name}
    >
      <AccountTable accounts={accounts} amountsHidden={amountsHidden} onAccountClick={onAccountClick} />
    </InstitutionCard>
  )
}

function HealthChip({ item }: { item: PlaidItem }) {
  if (item.healthState === 'HEALTHY') return null
  const isRepairable = item.healthState === 'LINK_UPDATE_REQUIRED'
  return (
    <>
      <span className={isRepairable ? 'inline-flex items-center gap-1 text-warning' : 'inline-flex items-center gap-1 text-negative'}>
        <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
        {isRepairable ? 'Update required' : 'Sync error'}
      </span>
      <span className="truncate">{healthMessage(item)}</span>
    </>
  )
}
