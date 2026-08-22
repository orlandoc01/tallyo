import type { ReactNode } from 'react'
import { Card } from '../common/FormControls'
import type { Account, Connection, EVMWallet } from '../../types/graphql'
import { EVMWalletRow } from './EVMWalletRow'
import { InstitutionRow, type InstitutionRowActions } from './InstitutionRow'

type InstitutionListActions = Omit<InstitutionRowActions, 'onDelete'> & {
  onDeleteConnection?: (connection: Connection) => void
}

export function InstitutionList({
  items,
  accounts = [],
  onAccountClick,
  onUpdateLogin,
  onSyncSettings,
  onAddManualAccount,
  onDisconnect,
  onReconnect,
  onDeleteConnection,
}: {
  items: Connection[]
  accounts?: Account[]
} & InstitutionListActions) {
  return (
    <div className="space-y-6">
      {items.map((connection) => {
        if (!connection.provider) return null

        if (connection.provider.__typename === 'PlaidItem') {
          return connectionSection(connection.id, (
            <InstitutionRow
              connection={connection}
              plaidItem={connection.provider}
              onAccountClick={onAccountClick}
              onUpdateLogin={onUpdateLogin}
              onSyncSettings={onSyncSettings}
              onAddManualAccount={onAddManualAccount}
              onDisconnect={onDisconnect}
              onReconnect={onReconnect}
              onDelete={onDeleteConnection}
            />
          ))
        }

        if (connection.provider.__typename === 'SimpleFinConnection') {
          return connectionSection(connection.id, (
            <InstitutionRow
              connection={connection}
              simpleFinConnection={connection.provider}
              onAccountClick={onAccountClick}
              onAddManualAccount={onAddManualAccount}
              onDisconnect={onDisconnect}
              onReconnect={onReconnect}
              onDelete={onDeleteConnection}
            />
          ))
        }

        if (connection.provider.__typename === 'EVMWallet') {
          const account = accounts.find((candidate) => candidate.connection?.id === connection.id)
          return connectionSection(connection.id, (
            <EVMWalletRow
              account={account}
              isActive={connection.isActive}
              wallet={connection.provider as EVMWallet}
              onAccountClick={onAccountClick}
              onDisconnect={onDisconnect ? () => onDisconnect(connection) : undefined}
              onReconnect={onReconnect ? () => onReconnect(connection) : undefined}
              onDelete={onDeleteConnection ? () => onDeleteConnection(connection) : undefined}
            />
          ))
        }
        return null
      })}
    </div>
  )
}

function connectionSection(key: string, row: ReactNode) {
  return <Card as="section" key={key} overflow="visible">{row}</Card>
}
