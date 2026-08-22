import { useState } from 'react'
import { House } from 'lucide-react'
import { useMutation } from 'urql'
import { UNLINK_REAL_ESTATE_MUTATION, UPDATE_REAL_ESTATE_MUTATION } from '../../graphql/mutations'
import type { Account } from '../../types/graphql'
import { Button } from '../common/Button'
import { TextField } from '../common/FormControls'
import { ActionMenuItem } from './ActionMenuItem'
import { formatAddress } from './propertyAddress'
import { RowActionsMenu } from './RowActionsMenu'
import { RowIconAvatar } from './RowIconAvatar'

export function RealEstateRow({
  connectionId,
  accountWealthProperty,
  account,
  onClick,
  onUpdated,
  onUnlink,
}: {
  connectionId: string
  accountWealthProperty: Account['accountWealthProperty']
  account?: Account
  onClick?: (account: Account) => void
  onUpdated?: () => void
  onUnlink?: (connectionId: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [, unlinkRealEstate] = useMutation<{ unlinkRealEstate: boolean }>(UNLINK_REAL_ESTATE_MUTATION)
  const [, updateValuation] = useMutation<{ updateRealEstate: { account: { id: string } } }>(UPDATE_REAL_ESTATE_MUTATION)

  async function handleUnlink() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    await unlinkRealEstate({ id: connectionId })
    setIsMenuOpen(false)
    onUnlink?.(connectionId)
  }

  async function handleSaveValuation() {
    const valueUSD = Number(value)
    if (!Number.isFinite(valueUSD) || valueUSD <= 0) {
      setError('Enter a positive valuation.')
      return
    }
    const result = await updateValuation({ input: { connectionId, valuationUSD: valueUSD } })
    if (result.error) {
      setError(result.error.message)
      return
    }
    setEditing(false)
    setValue('')
    setError(null)
    onUpdated?.()
  }

  const address = formatAddress(accountWealthProperty)
  const canShowActions = Boolean(onUpdated || onUnlink)

  return (
    <article className="px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button className="flex min-w-0 flex-1 items-center gap-4 text-left" disabled={!account || !onClick} onClick={() => account && onClick?.(account)} type="button">
          <RowIconAvatar color="emerald" icon={House} />
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-neutral-950" title={address || undefined}>{account?.name || address || 'Home'}</h2>
            <p className="break-all text-sm text-neutral-500">{address || 'Home'}</p>
            <p className="mt-1 text-xs text-neutral-400">Real estate valuation</p>
          </div>
        </button>

        {canShowActions ? (
          <RowActionsMenu
            ariaLabel="Open home actions"
            isOpen={isMenuOpen}
            onToggle={() => {
              setConfirming(false)
              setIsMenuOpen((open) => !open)
            }}
          >
            {onUpdated ? (
              <ActionMenuItem onClick={() => {
                setConfirming(false)
                setIsMenuOpen(false)
                setEditing((current) => !current)
              }}>
                {editing ? 'Hide update form' : 'Update value'}
              </ActionMenuItem>
            ) : null}
            {onUnlink ? (
              <ActionMenuItem destructive onClick={handleUnlink}>
                {confirming ? 'Confirm remove' : 'Remove'}
              </ActionMenuItem>
            ) : null}
          </RowActionsMenu>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
          <TextField className="min-w-64 flex-1" inputMode="decimal" label="Manual valuation USD" onChange={setValue} placeholder="850000" type="number" value={value} />
          <Button onClick={handleSaveValuation} type="button">Save</Button>
          {error ? <p className="basis-full text-sm text-red-600">{error}</p> : null}
        </div>
      ) : null}
    </article>
  )
}
