import { useState } from 'react'
import { Wallet } from 'lucide-react'
import type { Account, EVMWallet } from '../../types/graphql'
import { ActionMenuItem } from './ActionMenuItem'
import { RowActionsMenu } from './RowActionsMenu'
import { RowIconAvatar } from './RowIconAvatar'

export function EVMWalletRow({
  account,
  isActive,
  wallet,
  onAccountClick,
  onDisconnect,
  onReconnect,
  onDelete,
}: {
  account?: Account
  isActive: boolean
  wallet: EVMWallet
  onAccountClick?: (account: Account) => void
  onDisconnect?: () => void
  onReconnect?: () => void
  onDelete?: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    onDelete?.()
  }

  const name = account?.name || wallet.address

  return (
    <article className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
      <button className="flex min-w-0 flex-1 items-center gap-4 text-left" disabled={!account || !onAccountClick} onClick={() => account && onAccountClick?.(account)} type="button">
        <RowIconAvatar color="violet" icon={Wallet} />
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-neutral-950" title={wallet.address}>
            {name}
          </h2>
          <p className="break-all text-sm text-neutral-500">EVM wallet - {wallet.address}</p>
          <p className="mt-1 text-xs text-neutral-400">Balances synced across chains</p>
          {!isActive ? <span className="mt-2 inline-flex rounded-full bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-600">Disconnected</span> : null}
        </div>
      </button>

      {onDisconnect || onReconnect || onDelete ? (
        <RowActionsMenu ariaLabel="Open wallet actions" isOpen={isMenuOpen} onToggle={() => setIsMenuOpen((open) => !open)}>
          {isActive && onDisconnect ? <ActionMenuItem onClick={() => { setIsMenuOpen(false); onDisconnect() }}>Disconnect</ActionMenuItem> : null}
          {!isActive && onReconnect ? <ActionMenuItem onClick={() => { setIsMenuOpen(false); onReconnect() }}>Reconnect</ActionMenuItem> : null}
          {onDelete ? <ActionMenuItem destructive onClick={handleDelete}>{confirming ? 'Confirm delete' : 'Delete'}</ActionMenuItem> : null}
        </RowActionsMenu>
      ) : null}
    </article>
  )
}
