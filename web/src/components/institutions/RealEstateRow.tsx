import { useState } from 'react'
import { useMutation } from 'urql'
import { UNLINK_REAL_ESTATE_MUTATION, UPDATE_REAL_ESTATE_MUTATION } from '../../graphql/mutations'
import type { Account } from '../../types/graphql'
import { Button } from '../common/Button'
import { FormError, TextField } from '../common/FormControls'
import { AccountTable } from './AccountRows'
import { InstitutionCard } from './InstitutionCard'
import { formatAddress } from './propertyAddress'
import { RowActionsMenu, type RowAction } from '../common/RowActionsMenu'
import { SheetAvatar, SheetHero } from '../common/SheetHero'
import { institutionColor } from '../../utils/colors'

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
  const title = account?.name || address || 'Home'
  const menuItems: RowAction[] = [
    ...(onUpdated ? [{
      label: editing ? 'Hide update form' : 'Update value',
      onSelect: () => {
        setConfirming(false)
        setIsMenuOpen(false)
        setEditing((current) => !current)
      },
    }] : []),
    ...(onUnlink ? [{ label: confirming ? 'Confirm remove' : 'Remove', destructive: true, onSelect: () => { void handleUnlink() } }] : []),
  ]

  return (
    <InstitutionCard
      chips={<span>Real estate valuation</span>}
      menu={onUpdated || onUnlink ? (
        <RowActionsMenu
          ariaLabel="Open home actions"
          hero={<SheetHero avatar={<SheetAvatar color={institutionColor(title)} glyph={title.charAt(0).toUpperCase()} />} sub={address || 'Home'} title={title} />}
          isOpen={isMenuOpen}
          items={menuItems}
          onToggle={() => {
            setConfirming(false)
            setIsMenuOpen((open) => !open)
          }}
          title="Property"
        />
      ) : undefined}
      subtitle={address || 'Home'}
      title={title}
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
