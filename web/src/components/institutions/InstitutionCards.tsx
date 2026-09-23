import type { Connection, EVMWallet } from '../../types/graphql'
import { Card } from '../common/FormControls'
import type { InstitutionEntry } from './accountCards'
import { EVMWalletRow } from './EVMWalletRow'
import { InstitutionRow, type InstitutionRowActions } from './InstitutionRow'

export type InstitutionCardsActions = Omit<InstitutionRowActions, 'onDelete'> & {
  onDeleteConnection?: (connection: Connection) => void
}

export function InstitutionCards({
  items,
  amountsHidden = false,
  onAccountClick,
  onUpdateLogin,
  onSyncSettings,
  onAddManualAccount,
  onDisconnect,
  onReconnect,
  onDeleteConnection,
}: {
  items: InstitutionEntry[]
  amountsHidden?: boolean
} & InstitutionCardsActions) {
  return (
    <>
      {items.map(({ connection, accounts }) => {
        const provider = connection.provider
        if (!provider) return null

        if (provider.__typename === 'EVMWallet') {
          return (
            <Card as="section" key={connection.id} overflow="visible">
              <EVMWalletRow
                account={accounts[0]}
                amountsHidden={amountsHidden}
                isActive={connection.isActive}
                wallet={provider as EVMWallet}
                onAccountClick={onAccountClick}
                onDisconnect={onDisconnect ? () => onDisconnect(connection) : undefined}
                onReconnect={onReconnect ? () => onReconnect(connection) : undefined}
                onDelete={onDeleteConnection ? () => onDeleteConnection(connection) : undefined}
              />
            </Card>
          )
        }

        const providerProps = provider.__typename === 'PlaidItem'
          ? { plaidItem: provider, onUpdateLogin, onSyncSettings }
          : provider.__typename === 'SimpleFinConnection' ? { simpleFinConnection: provider } : null
        if (!providerProps) return null
        return (
          <Card as="section" key={connection.id} overflow="visible">
            <InstitutionRow
              {...providerProps}
              accounts={accounts}
              amountsHidden={amountsHidden}
              connection={connection}
              onAccountClick={onAccountClick}
              onAddManualAccount={onAddManualAccount}
              onDisconnect={onDisconnect}
              onReconnect={onReconnect}
              onDelete={onDeleteConnection}
            />
          </Card>
        )
      })}
    </>
  )
}
