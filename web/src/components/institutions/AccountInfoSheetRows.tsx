import { useState } from 'react'
import { useEVMChains } from '../../hooks/useEntityQueries'
import type { Account, AccountType } from '../../types/graphql'
import { ACCOUNT_TYPES, formatAccountType, isValidSubtypeForType, subtypeOptions } from '../../utils/accountSubtypes'
import { formatRelativeTime } from '../../utils/dates'
import { OwnerDot } from '../common/OwnerDot'
import { SheetAccordionRow, SheetField, SheetPickList, SheetStaticRow, SheetToggleRow } from '../common/SheetRows'
import { accountNumberLabel, titleCase } from './accountCards'
import { AddressFields } from './AddressFields'
import { formatAddress, joinAddress } from './propertyAddress'
import type { useAccountInfoForm } from './useAccountInfoForm'

type Section = 'name' | 'owner' | 'type' | 'subtype' | 'address' | 'chains' | 'notes'

function formatSubtype(subtype: string) {
  return subtype ? titleCase(subtype) : 'None'
}

// Mounted only for EVM wallets so other accounts never fetch the chain list.
function ChainsRow({ chainIds, changed, expanded, onChange, onToggle }: { chainIds: string[]; changed: boolean; expanded: boolean; onChange: (chainIds: string[]) => void; onToggle: () => void }) {
  const { chains } = useEVMChains()
  const selectedNames = chains.filter((chain) => chainIds.includes(chain.id)).map((chain) => chain.name)
  return (
    <SheetAccordionRow changed={changed} expanded={expanded} label="Chains" onToggle={onToggle} summary={selectedNames.join(', ') || 'Select at least one chain'}>
      <SheetPickList options={chains.map((chain) => ({ id: chain.id, ariaLabel: chain.name, label: chain.name }))} selectedIds={chainIds} selectionMode="multi" onChange={onChange} />
    </SheetAccordionRow>
  )
}

export function AccountInfoSheetRows({ account, form }: { account: Account; form: ReturnType<typeof useAccountInfoForm> }) {
  const [open, setOpen] = useState<Section | null>(null)
  const { canWriteAccounts, draft, evmWallet, handleDraftChange, isProperty, owners } = form
  const toggle = (section: Section) => () => setOpen((current) => current === section ? null : section)
  const pickOne = <T extends string>(apply: (id: T) => void) => ([id]: T[]) => { apply(id); setOpen(null) }
  const showSubtype = !isProperty && draft.type !== 'CRYPTO_WALLET'
  const typeOptions: readonly AccountType[] = ACCOUNT_TYPES.includes(draft.type) ? ACCOUNT_TYPES : [draft.type, ...ACCOUNT_TYPES]
  const subtypeIds = [
    '',
    ...(draft.subtype && !isValidSubtypeForType(draft.type, draft.subtype) ? [draft.subtype] : []),
    ...subtypeOptions(draft.type),
  ]
  const ownerName = owners.find((owner) => owner.id === draft.ownerId)?.name ?? account.owner.name

  return (
    <>
      {canWriteAccounts
        ? <SheetField changed={draft.name !== account.name} expanded={open === 'name'} label="Name" onChange={(name) => handleDraftChange({ name })} onToggle={toggle('name')} placeholder="Account name" value={draft.name} />
        : <SheetStaticRow label="Name" value={account.name} />}

      {canWriteAccounts ? (
        <SheetAccordionRow changed={draft.ownerId !== account.owner.id} expanded={open === 'owner'} label="Owner" onToggle={toggle('owner')} summary={ownerName}>
          <SheetPickList
            options={owners.map((owner) => ({ id: owner.id, ariaLabel: owner.name, label: owner.name, leading: <OwnerDot name={owner.name} /> }))}
            selectedIds={[draft.ownerId]}
            onChange={pickOne((ownerId) => handleDraftChange({ ownerId }))}
          />
        </SheetAccordionRow>
      ) : <SheetStaticRow label="Owner" value={account.owner.name} />}

      {account.typeLocked || !canWriteAccounts ? <SheetStaticRow label="Type" value={formatAccountType(draft.type)} /> : (
        <SheetAccordionRow changed={draft.type !== account.type} expanded={open === 'type'} label="Type" onToggle={toggle('type')} summary={formatAccountType(draft.type)}>
          <SheetPickList<AccountType>
            options={typeOptions.map((type) => ({ id: type, label: formatAccountType(type) }))}
            selectedIds={[draft.type]}
            onChange={pickOne(form.handleTypeChange)}
          />
        </SheetAccordionRow>
      )}

      {showSubtype && canWriteAccounts ? (
        <SheetAccordionRow changed={draft.subtype !== (account.subtype ?? '')} expanded={open === 'subtype'} label="Subtype" onToggle={toggle('subtype')} summary={formatSubtype(draft.subtype)}>
          <SheetPickList
            options={subtypeIds.map((subtype) => ({ id: subtype, label: subtype && !isValidSubtypeForType(draft.type, subtype) ? `${formatSubtype(subtype)} (unsupported)` : formatSubtype(subtype) }))}
            selectedIds={[draft.subtype]}
            onChange={pickOne((subtype) => handleDraftChange({ subtype }))}
          />
        </SheetAccordionRow>
      ) : showSubtype ? <SheetStaticRow label="Subtype" value={formatSubtype(draft.subtype)} /> : null}

      {isProperty && form.canEditPropertyAddress ? (
        <SheetAccordionRow changed={form.propertyAddressDirty} expanded={open === 'address'} label="Address" onToggle={toggle('address')} summary={joinAddress(draft.address) || 'Add address'}>
          <AddressFields address={draft.address} includeHomeType onChange={form.handleAddressChange} />
        </SheetAccordionRow>
      ) : isProperty ? <SheetStaticRow label="Address" value={formatAddress(account.accountWealthProperty) || 'Address not available'} /> : null}

      {evmWallet ? <ChainsRow chainIds={draft.chainIds} changed={form.chainsDirty} expanded={open === 'chains'} onChange={(chainIds) => handleDraftChange({ chainIds })} onToggle={toggle('chains')} /> : null}

      <SheetStaticRow label="Account number" value={accountNumberLabel(account.mask)} />
      <SheetStaticRow label="Last synced" value={account.lastSyncedAt ? formatRelativeTime(account.lastSyncedAt) : 'Never'} />

      {form.needsTypeReview ? <p className="border-t border-border py-3 text-sm text-warning">Verify this account type and save to clear it from review.</p> : null}

      <SheetField changed={draft.notes !== (account.notes ?? '')} disabled={!canWriteAccounts} expanded={open === 'notes'} label="Notes" multiline onChange={(notes) => handleDraftChange({ notes })} onToggle={toggle('notes')} placeholder="Add context or documentation for this account" value={draft.notes} />

      {canWriteAccounts ? (
        <>
          <SheetToggleRow
            checked={draft.closed}
            description={isProperty ? 'Mark this property as sold while keeping its history.' : 'Mark this account as closed while keeping its history.'}
            label={isProperty ? 'Sold' : 'Closed'}
            onChange={(closed) => handleDraftChange({ closed })}
          />
          <SheetToggleRow checked={draft.hidden} description="Hide this account and its transactions from lists and related views." label="Hidden" onChange={(hidden) => handleDraftChange({ hidden })} />
        </>
      ) : null}
    </>
  )
}
