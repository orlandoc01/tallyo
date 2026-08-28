import { useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Landmark } from 'lucide-react'
import type { Account, Connection, PlaidItem, SimpleFinConnection } from '../../types/graphql'
import { formatDisplayDate, formatRelativeTime } from '../../utils/dates'
import { ActionMenuItem } from './ActionMenuItem'
import { accountNeedsReview } from './connectionReview'
import { ManualAccountBadge } from './ManualAccountBadge'
import { RowActionsMenu } from './RowActionsMenu'
import { RowIconAvatar } from './RowIconAvatar'

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
} & InstitutionRowActions) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const provider = plaidItem ?? simpleFinConnection
  if (!provider) return null

  const name = connection.name || 'Unknown Institution'
  const credentialLabel = plaidItem ? plaidItem.credential.label || plaidItem.credential.clientId : 'SimpleFIN Bridge'
  const sortedAccounts = [...provider.accounts].sort((left, right) => accountStatusRank(left) - accountStatusRank(right))
  const isActive = connection.isActive
  const providerName = plaidItem ? 'Plaid' : 'SimpleFIN'
  const lastSyncedAt = plaidItem?.lastSyncedAt ?? simpleFinConnection?.lastSyncedAt

  return (
    <article className="grid gap-4 px-6 py-5 md:grid-cols-[1fr_auto_auto] md:items-center">
      <div className="flex items-center gap-4">
        <RowIconAvatar color="blue" icon={Landmark} />
        <div>
          <h2 className="text-lg font-bold text-neutral-950">{name}</h2>
          <p className="text-sm text-neutral-500">
            Connected {formatDateTime(provider.createdAt)} by {connection.owner.name}
          </p>
          <p className="text-sm text-neutral-600">
            {provider.accounts.length} {provider.accounts.length === 1 ? 'account' : 'accounts'}
          </p>
          {!isActive ? (
            <span className="mt-2 inline-flex rounded-full bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-600">Disconnected</span>
          ) : null}
          {plaidItem ? <HealthBadge healthState={plaidItem.healthState} isActive={isActive} /> : null}
        </div>
      </div>

      <div className="text-sm md:min-w-72">
        <p className="font-semibold text-neutral-950">{providerName}</p>
        <p className="text-neutral-500">
          {credentialLabel} {!isActive ? 'not syncing' : lastSyncedAt ? `synced ${formatRelativeTime(lastSyncedAt)}` : 'not synced yet'}
        </p>
        {isActive && plaidItem ? <p className="mt-1 text-xs text-neutral-500">Next transaction sync: {formatScheduleTime(plaidItem.nextSyncAt)}</p> : null}
        {isActive && plaidItem ? <p className="text-xs text-neutral-500">Next recurring sync: {formatScheduleTime(plaidItem.nextRecurringSyncAt)}</p> : null}
        {isActive && simpleFinConnection?.orgUrl ? <p className="mt-1 text-xs text-neutral-500">{simpleFinConnection.orgUrl}</p> : null}
        {isActive && plaidItem && plaidItem.healthState !== 'HEALTHY' ? <p className="mt-1 text-xs text-neutral-500">{healthMessage(plaidItem)}</p> : null}
      </div>

      <RowActionsMenu
        align="responsive-end"
        ariaLabel={`Open actions for ${name}`}
        isOpen={isMenuOpen && Boolean(onUpdateLogin || onSyncSettings || onAddManualAccount || onDisconnect || onReconnect || onDelete)}
        onToggle={() => setIsMenuOpen((open) => !open)}
      >
        {isActive && plaidItem && onUpdateLogin ? (
          <ActionMenuItem onClick={() => {
            setIsMenuOpen(false)
            onUpdateLogin(plaidItem)
          }}>
            Update login
          </ActionMenuItem>
        ) : null}
        {isActive && plaidItem && onSyncSettings ? (
          <ActionMenuItem onClick={() => {
            setIsMenuOpen(false)
            onSyncSettings(connection, plaidItem)
          }}>
            Sync settings
          </ActionMenuItem>
        ) : null}
        {isActive && onAddManualAccount ? (
          <ActionMenuItem onClick={() => {
            setIsMenuOpen(false)
            onAddManualAccount(connection.id, name)
          }}>
            Add manual account
          </ActionMenuItem>
        ) : null}
        {isActive && onDisconnect ? (
          <ActionMenuItem onClick={() => { setIsMenuOpen(false); onDisconnect(connection) }}>
            Disconnect
          </ActionMenuItem>
        ) : null}
        {!isActive && onReconnect ? (
          <ActionMenuItem onClick={() => { setIsMenuOpen(false); onReconnect(connection) }}>
            Reconnect
          </ActionMenuItem>
        ) : null}
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

      {provider.accounts.length > 0 ? (
        <div className="col-span-full md:col-span-3 md:col-start-1">
          <div className="mt-2 flex flex-col gap-2 pl-4">
            {sortedAccounts.map((account) => {
              const needsReview = accountNeedsReview(account)
              return (
                <button
                  className={clsx('flex items-start justify-between gap-4 text-left text-sm', account.closed || account.hidden ? 'text-neutral-400' : 'text-neutral-600')}
                  key={account.id}
                  onClick={() => onAccountClick(account)}
                  type="button"
                >
                  <span>
                    <span className={clsx('font-medium', account.closed || account.hidden ? 'text-neutral-400' : 'text-neutral-800')}>{account.name}</span>
                    {account.manual ? <span className="ml-2 inline-flex align-middle"><ManualAccountBadge /></span> : null}
                    {account.mask ? <span className="ml-1 text-neutral-400">•••• {account.mask}</span> : null}
                    <span className="ml-2 text-xs text-neutral-400 uppercase tracking-wide">
                      {account.type}
                      {account.subtype ? ` — ${account.subtype}` : ''}
                    </span>
                    {needsReview ? (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 align-middle text-xs font-semibold text-amber-700">
                        <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
                        verify type
                      </span>
                    ) : null}
                    {account.closed ? <span className="ml-2 text-xs font-semibold text-neutral-400">(CLOSED)</span> : null}
                    {account.hidden ? <span className="ml-2 text-xs font-semibold text-neutral-400">(HIDDEN)</span> : null}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </article>
  )
}

function accountStatusRank(account: Account) {
  if (account.closed) return 2
  if (account.hidden) return 1
  return 0
}

function HealthBadge({ healthState, isActive }: { healthState: PlaidItem['healthState']; isActive: boolean }) {
  if (!isActive || healthState === 'HEALTHY') return null

  const isRepairable = healthState === 'LINK_UPDATE_REQUIRED'
  return (
    <span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${isRepairable ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
      <AlertTriangle className="h-3.5 w-3.5" />
      {isRepairable ? 'Update required' : 'Sync error'}
    </span>
  )
}

function healthMessage(item: PlaidItem) {
  if (item.healthState === 'LINK_UPDATE_REQUIRED') {
    return 'Plaid needs this institution to be reconnected.'
  }
  return item.healthErrorMessage || item.healthErrorCode || 'Plaid sync is currently failing.'
}

function formatDateTime(value: string) {
  return formatDisplayDate(value.slice(0, 10))
}

function formatScheduleTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : 'not scheduled'
}
