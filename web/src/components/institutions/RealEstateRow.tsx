import { useState } from 'react'
import { useMutation } from 'urql'
import { UNLINK_REAL_ESTATE_MUTATION, UPDATE_REAL_ESTATE_MUTATION } from '../../graphql/mutations'
import type { Account } from '../../types/graphql'
import { Button } from '../common/Button'
import { FormError, TextField } from '../common/FormControls'
import { AccountTable } from './AccountRows'
import { ActionMenuItem } from '../common/ActionMenuItem'
import { InstitutionCard } from './InstitutionCard'
import { formatAddress } from './propertyAddress'
import { RowActionsMenu } from '../common/RowActionsMenu'

export function RealEstateRow({
  connectionId,
  accountWealthProperty,
  account,
  amountsHidden = false,
  onClick,
  onUpdated,
  onUnlink,
}: {
  connectionId: string
  accountWealthProperty: Account['accountWealthProperty']
  account?: Account
  amountsHidden?: boolean
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

  return (
    <InstitutionCard
      chips={<span>Real estate valuation</span>}
      menu={onUpdated || onUnlink ? (
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
          {onUnlink ? <ActionMenuItem destructive onClick={handleUnlink}>{confirming ? 'Confirm remove' : 'Remove'}</ActionMenuItem> : null}
        </RowActionsMenu>
      ) : undefined}
      subtitle={address || 'Home'}
      title={account?.name || address || 'Home'}
      titleAttr={address || undefined}
    >
      {editing ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-border bg-surface-2 px-4 py-3">
          <TextField className="min-w-64 flex-1" inputMode="decimal" label="Manual valuation USD" onChange={setValue} placeholder="850000" type="number" value={value} />
          <Button onClick={handleSaveValuation} type="button">Save</Button>
          {error ? <FormError className="basis-full">{error}</FormError> : null}
        </div>
      ) : null}
      {account ? <AccountTable accounts={[account]} amountsHidden={amountsHidden} onAccountClick={onClick} /> : null}
    </InstitutionCard>
  )
}
