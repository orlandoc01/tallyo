import { useState, type FormEvent } from 'react'
import { useMutation } from 'urql'
import { useNavigate } from 'react-router'
import type { Account, AccountType, UpdateConnectionInput, UpdateConnectionPayload, UpdateRealEstatePayload } from '../../types/graphql'
import { REMOVE_MANUAL_ACCOUNT_MUTATION, UPDATE_ACCOUNT_MUTATION, UPDATE_CONNECTION_MUTATION, UPDATE_REAL_ESTATE_MUTATION } from '../../graphql/mutations'
import { useOwners } from '../../hooks/useEntityQueries'
import { usePermissions } from '../../hooks/usePermissions'
import { isValidSubtypeForType } from '../../utils/accountSubtypes'
import type { AddressField } from './addressDraft'
import { AccountInfoActions, AccountInfoFields } from './AccountInfoFields'
import {
  accountAddressDraft,
  accountEVMWallet,
  accountInfoDirty,
  accountInfoDraft,
  addressDirty,
  buildAccountInfoInput,
  buildRealEstateInput,
  sameIds,
  type AccountInfoDraft,
} from './accountInfoDraft'
import { accountNeedsReview } from './connectionReview'

// The editable "Info" tab of the account detail modal: name/owner/type/subtype/
// notes/closed/hidden plus save and (manual-account) removal. Owns its own draft
// state and mutations; reports saved/removed accounts and errors to the parent.
export function AccountInfoForm({
  account,
  formErrorId,
  onAccountUpdate,
  onClose,
  onDelete,
  onError,
}: {
  account: Account
  formErrorId?: string
  onAccountUpdate: (account: Account) => void
  onClose: () => void
  onDelete?: (account: Account) => void
  onError: (message: string | null) => void
}) {
  const navigate = useNavigate()
  const { owners } = useOwners()
  const { canWrite } = usePermissions()
  const canWriteAccounts = canWrite('accounts')
  const [, updateAccount] = useMutation(UPDATE_ACCOUNT_MUTATION)
  const [, updateRealEstate] = useMutation<{ updateRealEstate: UpdateRealEstatePayload }>(UPDATE_REAL_ESTATE_MUTATION)
  const [, updateConnection] = useMutation<
    { updateConnection: UpdateConnectionPayload },
    { input: UpdateConnectionInput }
  >(UPDATE_CONNECTION_MUTATION)
  const [, removeManualAccount] = useMutation(REMOVE_MANUAL_ACCOUNT_MUTATION)

  const isProperty = account.type === 'PROPERTY'
  const currentAddress = accountAddressDraft(account)
  const [draft, setDraft] = useState(() => accountInfoDraft(account))
  const evmWallet = accountEVMWallet(account)
  const currentChainIds = evmWallet?.chainIds ?? []
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const canEditPropertyAddress = isProperty && !!account.connection
  const needsTypeReview = accountNeedsReview(account) && !account.typeLocked
  const infoDirty = accountInfoDirty(account, draft, needsTypeReview)
  const propertyAddressDirty = canEditPropertyAddress && addressDirty(currentAddress, draft.address)
  const chainsDirty = !!evmWallet && !sameIds(draft.chainIds, currentChainIds)
  const isDirty = infoDirty || propertyAddressDirty || chainsDirty

  // Changing the type narrows the valid subtypes; clear the subtype if it no
  // longer belongs to the newly selected type (the backend enforces the same).
  function handleTypeChange(nextType: AccountType) {
    setDraft((current) => ({
      ...current,
      subtype: current.subtype && !isValidSubtypeForType(nextType, current.subtype) ? '' : current.subtype,
      type: nextType,
    }))
  }

  function handleDraftChange(changes: Partial<AccountInfoDraft>) {
    setDraft((current) => ({ ...current, ...changes }))
  }

  function handleAddressChange(field: AddressField, value: string) {
    setDraft((current) => ({
      ...current,
      address: { ...current.address, [field]: value },
    }))
  }

  function handleViewTransactions() {
    onClose()
    navigate(`/transactions?account_ids=${account.id}`)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!isDirty) return

    setIsSaving(true)
    onError(null)

    let updatedAccount: Account | null = null
    try {
      if (infoDirty) {
        const input = buildAccountInfoInput(account, draft)
        const result = await updateAccount({ input: { id: account.id, ...input } })
        if (result.error) {
          onError(result.error.message)
          return
        }
        updatedAccount = result.data?.updateAccount?.account ?? updatedAccount
      }

      if (propertyAddressDirty) {
        const connection = account.connection
        if (!connection) {
          onError('Cannot update address for this account.')
          return
        }
        const result = await updateRealEstate({ input: buildRealEstateInput(connection.id, currentAddress, draft.address) })
        if (result.error) {
          if (updatedAccount) onAccountUpdate(updatedAccount)
          onError(result.error.message)
          return
        }
        updatedAccount = result.data?.updateRealEstate?.account ?? updatedAccount
      }

      if (chainsDirty) {
        const connection = account.connection
        if (!connection) {
          onError('Cannot update chains for this account.')
          return
        }
        const result = await updateConnection({ input: { connectionId: connection.id, chainIds: draft.chainIds } })
        if (result.error) {
          if (updatedAccount) onAccountUpdate(updatedAccount)
          onError(result.error.message)
          return
        }
        updatedAccount = {
          ...(updatedAccount ?? account),
          connection: result.data?.updateConnection.connection ?? connection,
        }
      }

      if (updatedAccount) {
        onAccountUpdate(updatedAccount)
      }
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRemoveManualAccount() {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }

    setIsDeleting(true)
    onError(null)
    const result = await removeManualAccount({ input: { id: account.id } })
    setIsDeleting(false)

    if (result.error) {
      onError(result.error.message)
      return
    }

    onDelete?.(account)
    onClose()
  }

  return (
    <form aria-describedby={formErrorId} className="mt-4 space-y-3 border-t border-neutral-100 pt-4" onSubmit={handleSave}>
      <AccountInfoFields
        account={account}
        canWriteAccounts={canWriteAccounts}
        draft={draft}
        onAddressChange={handleAddressChange}
        onDraftChange={handleDraftChange}
        onTypeChange={handleTypeChange}
        owners={owners}
      />
      <AccountInfoActions
        account={account}
        canWriteAccounts={canWriteAccounts}
        confirmingDelete={confirmingDelete}
        disableSave={isSaving || isDeleting || !isDirty || !draft.name.trim() || (!!evmWallet && draft.chainIds.length === 0)}
        isDeleting={isDeleting}
        isProperty={isProperty}
        isSaving={isSaving}
        onRemoveManualAccount={handleRemoveManualAccount}
        onViewTransactions={handleViewTransactions}
      />
    </form>
  )
}
