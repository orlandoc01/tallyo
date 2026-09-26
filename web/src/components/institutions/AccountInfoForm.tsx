import type { FormEvent } from 'react'
import type { Account } from '../../types/graphql'
import { AccountInfoActions, AccountInfoFields } from './AccountInfoFields'
import { useAccountInfoForm } from './useAccountInfoForm'

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
  const form = useAccountInfoForm({ account, onAccountUpdate, onClose, onDelete, onError })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void form.handleSave()
  }

  return (
    <form aria-describedby={formErrorId} className="mt-4 space-y-3 border-t border-border pt-4" onSubmit={handleSubmit}>
      <AccountInfoFields
        account={account}
        canWriteAccounts={form.canWriteAccounts}
        draft={form.draft}
        onAddressChange={form.handleAddressChange}
        onDraftChange={form.handleDraftChange}
        onTypeChange={form.handleTypeChange}
        owners={form.owners}
      />
      <AccountInfoActions
        account={account}
        canWriteAccounts={form.canWriteAccounts}
        confirmingDelete={form.confirmingDelete}
        disableSave={form.disableSave}
        isDeleting={form.isDeleting}
        isProperty={form.isProperty}
        isSaving={form.isSaving}
        onRemoveManualAccount={form.handleRemoveManualAccount}
        onViewTransactions={form.handleViewTransactions}
      />
    </form>
  )
}
