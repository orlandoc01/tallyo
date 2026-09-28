import type { FormEvent } from 'react'
import { FormError, SelectField, TextAreaField, TextField } from '../common/FormControls'
import { ToggleSettingRow } from '../common/ToggleSwitch'
import { Modal, ModalActions, ModalFooter } from '../common/Modal'
import { ModalCloseButton } from '../common/ModalHeader'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { Account, Category, Transaction } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { CreateTransactionSheet } from './CreateTransactionSheet'
import { useCreateTransactionForm } from './useCreateTransactionForm'

export function CreateTransactionModal({
  accounts,
  categories,
  onClose,
  onCreated,
}: {
  accounts: Account[]
  categories: Category[]
  onClose: () => void
  onCreated: (transaction: Transaction) => void
}) {
  const isMobile = useIsMobile()
  const form = useCreateTransactionForm({ accounts, onCreated })
  const { draft, error, patch, saving, visibleAccounts } = form

  if (isMobile) return <CreateTransactionSheet categories={categories} form={form} onClose={onClose} />

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void form.save()
  }

  return (
    <Modal label="Create transaction" onClose={onClose} scrollable size="lg">
      <form className="space-y-5" noValidate onSubmit={handleSubmit}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-text-1">Create transaction</h2>
            <p className="text-sm text-text-3">Manual transactions receive a server-generated ID.</p>
          </div>
          <ModalCloseButton label="Close create transaction" onClick={onClose} />
        </div>

        {error ? <FormError>{error}</FormError> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField className="sm:col-span-2" disabled={visibleAccounts.length === 0} label="Account" onChange={(accountId) => patch({ accountId })} options={visibleAccounts.map((account) => ({ label: accountDisplayLabel(account), value: account.id }))} required value={draft.accountId} />
          <TextField label="Date" onChange={(date) => patch({ date })} required type="date" value={draft.date} />
          <TextField inputMode="decimal" label="Amount" onChange={(amount) => patch({ amount })} placeholder="42.50" required step="0.01" type="number" value={draft.amount} />
          <TextField label="Merchant" onChange={(merchantName) => patch({ merchantName })} placeholder="Coffee Shop" value={draft.merchantName} />
          <TextField label="Original name" onChange={(originalName) => patch({ originalName })} placeholder="POS COFFEE SHOP" value={draft.originalName} />
          <SelectField
            className="sm:col-span-2"
            label="Category"
            onChange={(categoryId) => patch({ categoryId })}
            options={[{ label: 'Uncategorized', value: '' }, ...categories.map((category) => ({ label: `${category.emoji} ${category.groupName} / ${category.name}`, value: category.id }))]}
            value={draft.categoryId}
          />
        </div>

        <p className="text-xs text-text-3">Use positive amounts for spending and negative amounts for refunds or credits.</p>

        <div className="space-y-2 border-t border-border pt-4">
          <ToggleSettingRow checked={draft.isHidden} onChange={(isHidden) => patch({ isHidden })} title="Hidden" />
          <ToggleSettingRow checked={draft.isRecurring} onChange={(isRecurring) => patch({ isRecurring })} title="Recurring" />
        </div>

        <TextAreaField label="Notes" onChange={(notes) => patch({ notes })} rows={3} value={draft.notes} />

        {visibleAccounts.length === 0 ? <div className="rounded-xl bg-warning/[0.12] px-3 py-2 text-sm text-warning">Add an account before creating transactions.</div> : null}

        <ModalFooter>
          <ModalActions busy={saving} busyLabel="Creating..." disabled={saving || visibleAccounts.length === 0} onCancel={onClose} submitLabel="Create transaction" />
        </ModalFooter>
      </form>
    </Modal>
  )
}
