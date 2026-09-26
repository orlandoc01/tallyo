import { useState } from 'react'
import type { Account, EVMWallet } from '../../types/graphql'
import { syncChipStatus } from './accountCards'
import { AccountTable } from './AccountRows'
import { InstitutionCard, ProviderChip } from './InstitutionCard'
import { RowActionsMenu, type RowAction } from '../common/RowActionsMenu'
import { SheetAvatar, SheetHero } from '../common/SheetHero'
import { institutionColor } from '../../utils/colors'

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

  const title = account?.name || wallet.address
  const menuItems: RowAction[] = [
    ...(isActive && onDisconnect ? [{ label: 'Disconnect', onSelect: () => { setIsMenuOpen(false); onDisconnect() } }] : []),
    ...(!isActive && onReconnect ? [{ label: 'Reconnect', onSelect: () => { setIsMenuOpen(false); onReconnect() } }] : []),
    ...(onDelete ? [{ label: confirming ? 'Confirm delete' : 'Delete', destructive: true, onSelect: handleDelete }] : []),
  ]

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
        <RowActionsMenu
          ariaLabel="Open wallet actions"
          hero={<SheetHero avatar={<SheetAvatar color={institutionColor(title)} glyph={title.charAt(0).toUpperCase()} />} sub={`EVM wallet · ${sync.text}`} title={title} />}
          isOpen={isMenuOpen}
          items={menuItems}
          onToggle={toggleMenu}
          title="Wallet"
        />
      ) : undefined}
      subtitle={`EVM wallet · ${wallet.address}`}
      title={title}
      titleAttr={wallet.address}
    >
      {account ? <AccountTable accounts={[account]} amountsHidden={amountsHidden} onAccountClick={onAccountClick} /> : null}
    </InstitutionCard>
  )
}
