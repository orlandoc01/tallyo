import type { Account, AccountType, Owner } from '../../types/graphql'
import { Button } from '../common/Button'
import { FieldLabel, SelectField, TextAreaField, TextField } from '../common/FormControls'
import { ToggleSwitch } from '../common/ToggleSwitch'
import {
  ACCOUNT_TYPES,
  formatAccountType,
  isValidSubtypeForType,
  subtypeOptions,
} from '../../utils/accountSubtypes'
import type { AddressField } from './addressDraft'
import { accountEVMWallet, type AccountInfoDraft } from './accountInfoDraft'
import { ChainPicker } from './ChainPicker'
import { accountNeedsReview } from './connectionReview'
import { OwnerSelect } from './OwnerSelect'
import { PropertyAddressSection } from './PropertyAddressSection'

type AccountInfoFieldsProps = {
  account: Account
  canWriteAccounts: boolean
  draft: AccountInfoDraft
  onAddressChange: (field: AddressField, value: string) => void
  onDraftChange: (changes: Partial<AccountInfoDraft>) => void
  onTypeChange: (type: AccountType) => void
  owners: Owner[]
}

export function AccountInfoFields({
  account,
  canWriteAccounts,
  draft,
  onAddressChange,
  onDraftChange,
  onTypeChange,
  owners,
}: AccountInfoFieldsProps) {
  const isProperty = account.type === 'PROPERTY'
  const hasEVMWallet = !!accountEVMWallet(account)
  const needsTypeReview = accountNeedsReview(account) && !account.typeLocked
  const canEditPropertyAddress = isProperty && !!account.connection
  const showSubtype = !isProperty && draft.type !== 'CRYPTO_WALLET'
  const typeOptions = ACCOUNT_TYPES.includes(draft.type) ? ACCOUNT_TYPES : [draft.type, ...ACCOUNT_TYPES]

  return (
    <>
      <TextField aria-invalid={!draft.name.trim()} label="Name" labelSuffix={<span aria-hidden="true" className="text-red-500"> *</span>} onChange={(name) => onDraftChange({ name })} required type="text" value={draft.name} />

      <FieldLabel label="Owner">
        <OwnerSelect
          canCreate={false}
          onChange={(ownerId) => onDraftChange({ ownerId })}
          onOwnerCreated={() => {}}
          owners={owners}
          value={draft.ownerId}
        />
      </FieldLabel>

      <div className={showSubtype || isProperty ? 'grid gap-3 lg:grid-cols-2' : 'grid gap-3'}>
        <SelectField disabled={account.typeLocked} label="Type" onChange={onTypeChange} options={typeOptions.map((t) => ({ label: formatAccountType(t), value: t }))} value={draft.type} />

        {isProperty ? (
          <PropertyAddressSection
            account={account}
            addressDraft={draft.address}
            canEdit={canEditPropertyAddress}
            onAddressChange={onAddressChange}
          />
        ) : showSubtype ? (
          <SelectField
            label="Subtype"
            onChange={(subtype) => onDraftChange({ subtype })}
            options={[
              { label: 'None', value: '' },
              ...(draft.subtype && !isValidSubtypeForType(draft.type, draft.subtype) ? [{ label: `${draft.subtype} (unsupported)`, value: draft.subtype }] : []),
              ...subtypeOptions(draft.type),
            ]}
            value={draft.subtype}
          />
        ) : null}
      </div>

      {hasEVMWallet ? (
        <fieldset className="space-y-2 rounded-2xl border border-neutral-200 p-4">
          <legend className="px-1 text-sm font-semibold text-neutral-950">Chains</legend>
          <ChainPicker chainIds={draft.chainIds} onChange={(chainIds) => onDraftChange({ chainIds })} />
          {draft.chainIds.length === 0 ? <p className="text-xs text-red-600">Select at least one chain.</p> : null}
        </fieldset>
      ) : null}

      {needsTypeReview ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Verify this account type and save to clear it from review.
        </p>
      ) : null}

      {canWriteAccounts ? (
        <div className="space-y-3 pt-1">
          <AccountStatusToggle
            checked={draft.closed}
            description={isProperty ? 'Mark this property as sold while keeping its history.' : 'Mark this account as closed while keeping its history.'}
            label={isProperty ? 'Sold' : 'Closed'}
            onChange={(closed) => onDraftChange({ closed })}
          />
          <AccountStatusToggle
            checked={draft.hidden}
            description="Hide this account and its transactions from lists and related views."
            label="Hidden"
            onChange={(hidden) => onDraftChange({ hidden })}
          />
        </div>
      ) : null}

      <TextAreaField label="Notes" minHeight="min-h-24" onChange={(notes) => onDraftChange({ notes })} placeholder="Add context or documentation for this account" value={draft.notes} />
    </>
  )
}

type AccountInfoActionsProps = {
  account: Account
  canWriteAccounts: boolean
  confirmingDelete: boolean
  disableSave: boolean
  isDeleting: boolean
  isProperty: boolean
  isSaving: boolean
  onRemoveManualAccount: () => void
  onViewTransactions: () => void
}

export function AccountInfoActions({
  account,
  canWriteAccounts,
  confirmingDelete,
  disableSave,
  isDeleting,
  isProperty,
  isSaving,
  onRemoveManualAccount,
  onViewTransactions,
}: AccountInfoActionsProps) {
  return (
    <div className="flex items-center justify-between border-t border-neutral-100 pt-3">
      {!isProperty ? (
        <Button onClick={onViewTransactions} type="button" variant="secondary">
          View transactions
        </Button>
      ) : null}
      <div className="ml-auto flex items-center gap-3">
        {canWriteAccounts && account.manual ? (
          <Button disabled={isSaving || isDeleting} onClick={onRemoveManualAccount} type="button" variant="danger">
            {isDeleting ? 'Removing…' : confirmingDelete ? 'Confirm remove' : 'Remove'}
          </Button>
        ) : null}
        {canWriteAccounts ? (
          <Button disabled={disableSave} type="submit">
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function AccountStatusToggle({ checked, description, label, onChange }: { checked: boolean; description: string; label: string; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-200 bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-neutral-950">{label}</p>
        <p className="mt-1 text-sm text-neutral-500">{description}</p>
      </div>
      <ToggleSwitch checked={checked} label={label} onChange={onChange} />
    </div>
  )
}
