import { useState } from 'react'
import type { Account, EVMWallet } from '../../types/graphql'
import { syncChipStatus } from './accountCards'
import { AccountTable } from './AccountRows'
import { ActionMenuItem } from '../common/ActionMenuItem'
import { InstitutionCard, ProviderChip } from './InstitutionCard'
import { RowActionsMenu } from '../common/RowActionsMenu'

export function EVMWalletRow({
  account,
  amountsHidden = false,
  isActive,
  wallet,
  onAccountClick,
  onDisconnect,
  onReconnect,
  onDelete,
}: {
  account?: Account
  amountsHidden?: boolean
  isActive: boolean
  wallet: EVMWallet
  onAccountClick?: (account: Account) => void
  onDisconnect?: () => void
  onReconnect?: () => void
  onDelete?: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const sync = syncChipStatus(isActive, account?.lastSyncedAt)

  function toggleMenu() {
    setConfirming(false)
    setIsMenuOpen((open) => !open)
  }

  function handleDelete() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    onDelete?.()
  }

  return (
    <InstitutionCard
      chips={(
        <ProviderChip tone={sync.tone}>
          <span>EVM</span>
          <span aria-hidden>·</span>
          <span>{sync.text}</span>
        </ProviderChip>
      )}
      menu={onDisconnect || onReconnect || onDelete ? (
        <RowActionsMenu ariaLabel="Open wallet actions" isOpen={isMenuOpen} onToggle={toggleMenu}>
          {isActive && onDisconnect ? <ActionMenuItem onClick={() => { setIsMenuOpen(false); onDisconnect() }}>Disconnect</ActionMenuItem> : null}
          {!isActive && onReconnect ? <ActionMenuItem onClick={() => { setIsMenuOpen(false); onReconnect() }}>Reconnect</ActionMenuItem> : null}
          {onDelete ? <ActionMenuItem destructive onClick={handleDelete}>{confirming ? 'Confirm delete' : 'Delete'}</ActionMenuItem> : null}
        </RowActionsMenu>
      ) : undefined}
      subtitle={`EVM wallet · ${wallet.address}`}
      title={account?.name || wallet.address}
      titleAttr={wallet.address}
    >
      {account ? <AccountTable accounts={[account]} amountsHidden={amountsHidden} onAccountClick={onAccountClick} /> : null}
    </InstitutionCard>
  )
}
