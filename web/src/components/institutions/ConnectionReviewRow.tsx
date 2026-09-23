import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Account, Connection, PlaidItem, SimpleFinConnection } from '../../types/graphql'
import { formatRelativeTime } from '../../utils/dates'
import { Button } from '../common/Button'
import { DataGridRow, DataGridSubRow, dataGridTextCell } from '../common/DataGrid'
import { Tag } from '../common/Tag'
import { accountNeedsReview, healthMessage } from './connectionReview'

export function ConnectionReviewRow({ compact, confirmingDelete, connection, provider, onAccountClick, onConfirmDelete, onDelete, onDisconnect, onUpdateLogin }: {
  compact: boolean
  confirmingDelete: boolean
  connection: Connection
  provider: PlaidItem | SimpleFinConnection
  onAccountClick: (account: Account) => void
  onConfirmDelete: () => void
  onDelete?: () => void
  onDisconnect?: () => void
  onUpdateLogin?: () => void
}) {
  const plaidItem = provider.__typename === 'PlaidItem' ? provider : null
  const name = connection.name || 'Unknown Institution'
  const issue = plaidItem && plaidItem.healthState !== 'HEALTHY' ? healthMessage(plaidItem) : null
  const summary = syncSummary(connection, provider, plaidItem)
  const reviewAccounts = provider.accounts.filter(accountNeedsReview)

  const title = (
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate font-medium text-text-1">{name}</span>
      {plaidItem ? <HealthTag healthState={plaidItem.healthState} /> : null}
    </div>
  )
  const actions = (
    <div className={compact ? 'mt-2 flex flex-wrap gap-2' : 'flex items-center gap-2'}>
      {plaidItem && onUpdateLogin ? <Button onClick={onUpdateLogin} size="sm" variant="secondary">Update login</Button> : null}
      {onDisconnect ? <Button onClick={onDisconnect} size="sm" variant="secondary">Disconnect</Button> : null}
      {onDelete ? (
        <Button onClick={confirmingDelete ? onDelete : onConfirmDelete} size="sm" variant="danger">
          {confirmingDelete ? 'Confirm delete' : 'Delete'}
        </Button>
      ) : null}
    </div>
  )

  return (
    <>
      {compact ? (
        <div className="min-h-[52px] border-t border-border px-4 py-2.5">
          {title}
          <TruncatedLine className="text-xs text-text-3">{summary}</TruncatedLine>
          {issue ? <TruncatedLine className="text-xs text-text-muted">{issue}</TruncatedLine> : null}
          {actions}
        </div>
      ) : (
        <DataGridRow gridTemplateColumns="minmax(0,1.4fr) minmax(0,1fr) auto">
          {title}
          <div className={dataGridTextCell}>
            <TruncatedLine className="text-[13px] text-text-3">{summary}</TruncatedLine>
            {issue ? <TruncatedLine className="text-xs text-text-muted">{issue}</TruncatedLine> : null}
          </div>
          {actions}
        </DataGridRow>
      )}
      {reviewAccounts.map((account) => (
        <DataGridSubRow gridTemplateColumns="minmax(0,1fr) auto" key={account.id} onClick={() => onAccountClick(account)}>
          <div className={dataGridTextCell}>
            <span className="text-text-1">{account.name}</span>
            {account.mask ? <span className="text-text-muted"> •••• {account.mask}</span> : null}
            <span className="ml-2 text-[11px] uppercase tracking-[0.6px] text-text-muted">{account.type}{account.subtype ? ` — ${account.subtype}` : ''}</span>
          </div>
          <Tag tint="amber"><AlertTriangle aria-hidden className="h-3 w-3" />verify type</Tag>
        </DataGridSubRow>
      ))}
    </>
  )
}

function TruncatedLine({ children, className }: { children: string; className: string }) {
  return <div className={`truncate ${className}`} title={children}>{children}</div>
}

function HealthTag({ healthState }: { healthState: PlaidItem['healthState'] }): ReactNode {
  if (healthState === 'HEALTHY') return null
  const repairable = healthState === 'LINK_UPDATE_REQUIRED'
  return (
    <Tag className="shrink-0" tint={repairable ? 'amber' : 'red'}>
      <AlertTriangle aria-hidden className="h-3 w-3" />
      {repairable ? 'Update required' : 'Sync error'}
    </Tag>
  )
}

function syncSummary(connection: Connection, provider: PlaidItem | SimpleFinConnection, plaidItem: PlaidItem | null) {
  const source = plaidItem ? `Plaid · ${plaidItem.credential.label || plaidItem.credential.clientId}` : 'SimpleFIN'
  const synced = !connection.isActive ? 'not syncing' : provider.lastSyncedAt ? `synced ${formatRelativeTime(provider.lastSyncedAt)}` : 'not synced yet'
  return `${source} · ${synced}`
}
