import { useState } from 'react'
import { useMutation } from 'urql'
import { FormError, TextAreaField } from '../common/FormControls'
import { ModalCloseButton } from '../common/ModalHeader'
import type { Category, Transaction, TransactionUpdates } from '../../types/graphql'
import { DELETE_TRANSACTION_MUTATION, UPDATE_TRANSACTION_MUTATION } from '../../graphql/mutations'
import { usePermissions } from '../../hooks/usePermissions'
import { ToggleRow } from './ToggleRow'
import { TransactionDetailsFields } from './TransactionDetailsFields'
import { TransactionTagsSection } from './TransactionTagsSection'

export function TransactionDetailsPane({
  categories,
  onClose,
  onDelete,
  onUpdate,
  transaction,
}: {
  categories: Category[]
  onClose: () => void
  onDelete?: (id: string) => void
  onUpdate?: (updated: Transaction) => void
  transaction: Transaction
}) {
  const [, updateTransaction] = useMutation(UPDATE_TRANSACTION_MUTATION)
  const [, deleteTransaction] = useMutation(DELETE_TRANSACTION_MUTATION)

  const [merchantNameDraft, setMerchantNameDraft] = useState(transaction.merchantName ?? '')
  const [notesDraft, setNotesDraft] = useState(transaction.notes ?? '')
  const [isHiddenDraft, setIsHiddenDraft] = useState(transaction.isHidden)
  const [isRecurringDraft, setIsRecurringDraft] = useState(transaction.isRecurring)
  const [isSavingMerchantName, setIsSavingMerchantName] = useState(false)
  const [isSavingNotes, setIsSavingNotes] = useState(false)
  const [isSavingCategory, setIsSavingCategory] = useState(false)
  const [isSavingToggle, setIsSavingToggle] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { canWrite } = usePermissions()
  const canWriteTransactions = canWrite('transactions')

  async function applyUpdate(updates: TransactionUpdates, setSaving?: (saving: boolean) => void) {
    setSaving?.(true)
    setError(null)

    const result = await updateTransaction({ input: { id: transaction.id, updates } })

    setSaving?.(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    if (result.data?.updateTransaction?.transaction) {
      onUpdate?.(result.data.updateTransaction.transaction)
    }
  }

  async function saveToggle(updates: Pick<TransactionUpdates, 'isHidden' | 'isRecurring'>) {
    if (!canWriteTransactions) return
    await applyUpdate(updates, setIsSavingToggle)
  }

  async function handleSaveNotes() {
    if (!canWriteTransactions) return
    if (notesDraft === (transaction.notes ?? '')) return
    await applyUpdate({ notes: notesDraft || null }, setIsSavingNotes)
  }

  async function handleSaveMerchantName() {
    if (!canWriteTransactions) return
    if (merchantNameDraft === (transaction.merchantName ?? '')) return
    await applyUpdate({ merchantName: merchantNameDraft || null }, setIsSavingMerchantName)
  }

  async function handleDelete() {
    const confirmed = window.confirm(`Delete ${merchant}? This cannot be undone.`)
    if (!confirmed) return

    setIsDeleting(true)
    setError(null)

    const result = await deleteTransaction({ id: transaction.id })

    setIsDeleting(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    if (result.data?.deleteTransaction?.success) {
      onDelete?.(transaction.id)
      return
    }

    setError('Transaction was not found.')
  }

  const merchant = transaction.merchantName || transaction.originalName || 'Unknown merchant'

  return (
    <div className="flex flex-col gap-4" role="region" aria-label={`Details for ${merchant}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">Details</h3>
        <ModalCloseButton label={`Close details for ${merchant}`} onClick={onClose} />
      </div>

      {error ? <FormError>{error}</FormError> : null}

      <TransactionDetailsFields
        canWriteTransactions={canWriteTransactions}
        categories={categories}
        isSavingCategory={isSavingCategory}
        isSavingMerchantName={isSavingMerchantName}
        onChangeCategory={(category) => applyUpdate({ categoryId: category.id }, setIsSavingCategory)}
        onChangeMerchantName={setMerchantNameDraft}
        onSaveMerchantName={handleSaveMerchantName}
        merchantNameDraft={merchantNameDraft}
        transaction={transaction}
      />

      <div className="space-y-2 border-t border-neutral-100 pt-4">
        <ToggleRow
          disabled={isSavingToggle || !canWriteTransactions}
          label="Hidden"
          onChange={async (value) => {
            setIsHiddenDraft(value)
            await saveToggle({ isHidden: value })
          }}
          value={isHiddenDraft}
        />
        <ToggleRow
          disabled={isSavingToggle || !canWriteTransactions}
          label="Recurring"
          onChange={async (value) => {
            setIsRecurringDraft(value)
            await saveToggle({ isRecurring: value })
          }}
          value={isRecurringDraft}
        />
      </div>

      <div className="space-y-2 border-t border-neutral-100 pt-4">
        <TextAreaField aria-readonly={!canWriteTransactions} controlClassName={canWriteTransactions ? undefined : 'cursor-not-allowed bg-neutral-50 text-neutral-500 focus:border-neutral-200 focus:ring-0'} disabled={isSavingNotes} id="txn-notes" label="Notes" onBlur={handleSaveNotes} onChange={setNotesDraft} readOnly={!canWriteTransactions} rows={3} value={notesDraft} />
        {isSavingNotes && <div className="text-xs text-neutral-400">Saving...</div>}
      </div>

      <TransactionTagsSection onSetTagIds={(tagIds) => applyUpdate({ tagIds })} transaction={transaction} />

      <div className="space-y-2 border-t border-neutral-100 pt-4 text-xs text-neutral-400">
        <div className="flex justify-between gap-3">
          <span>Transaction ID</span>
          <span className="min-w-0 max-w-[65%] truncate font-mono" title={transaction.id}>
            {transaction.id}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Created</span>
          <span>{new Date(transaction.createdAt).toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span>Updated</span>
          <span>{new Date(transaction.updatedAt).toLocaleString()}</span>
        </div>
      </div>

      <div className="border-t border-red-100 pt-4">
        <button
          className="w-full rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isDeleting}
          onClick={handleDelete}
          type="button"
        >
          {isDeleting ? 'Deleting...' : 'Delete transaction'}
        </button>
      </div>
    </div>
  )
}
