import clsx from 'clsx'
import { useState } from 'react'
import { useMutation } from 'urql'
import { Avatar } from '../common/Avatar'
import { Button } from '../common/Button'
import { FormError, TextAreaField, TextField } from '../common/FormControls'
import { ModalCloseButton } from '../common/ModalHeader'
import { ToggleSwitch } from '../common/ToggleSwitch'
import type { Category, Transaction, TransactionUpdates } from '../../types/graphql'
import { DELETE_TRANSACTION_MUTATION, UPDATE_TRANSACTION_MUTATION } from '../../graphql/mutations'
import { usePermissions } from '../../hooks/usePermissions'
import { categoryTint } from '../../utils/categoryTint'
import { formatTransactionAmount, transactionAmountClassName } from '../../utils/currency'
import { TransactionDetailsFields } from './TransactionDetailsFields'
import { TransactionTagsSection } from './TransactionTagsSection'

function DetailToggleRow({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <div className="flex h-12 items-center justify-between border-b border-border">
      <span className="text-sm text-text-1">{label}</span>
      <ToggleSwitch checked={checked} disabled={disabled} label={label} onChange={onChange} size="lg" />
    </div>
  )
}

export function TransactionDetailsPane({
  categories,
  onClose,
  onDelete,
  onShowMerchant,
  onUpdate,
  titleId,
  transaction,
}: {
  categories: Category[]
  onClose: () => void
  onDelete?: (id: string) => void
  onShowMerchant?: (merchant: string) => void
  onUpdate?: (updated: Transaction) => void
  titleId?: string
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
    if (result.data?.updateTransaction?.transaction) onUpdate?.(result.data.updateTransaction.transaction)
  }

  async function saveToggle(updates: Pick<TransactionUpdates, 'isHidden' | 'isRecurring'>) {
    if (!canWriteTransactions) return
    await applyUpdate(updates, setIsSavingToggle)
  }

  async function handleSaveNotes() {
    if (!canWriteTransactions || notesDraft === (transaction.notes ?? '')) return
    await applyUpdate({ notes: notesDraft || null }, setIsSavingNotes)
  }

  async function handleSaveMerchantName() {
    if (!canWriteTransactions || merchantNameDraft === (transaction.merchantName ?? '')) return
    await applyUpdate({ merchantName: merchantNameDraft || null }, setIsSavingMerchantName)
  }

  async function handleDelete() {
    if (!window.confirm(`Delete ${merchant}? This cannot be undone.`)) return
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

  const merchantName = transaction.merchantName
  const merchant = merchantName || transaction.originalName || 'Unknown merchant'
  const togglesDisabled = isSavingToggle || !canWriteTransactions

  return (
    <div aria-label={`Details for ${merchant}`} className="relative" role="region">
      <ModalCloseButton className="absolute -right-2 -top-2" label={`Close details for ${merchant}`} onClick={onClose} />
      <div className="flex items-center gap-3 pr-8">
        <Avatar name={merchant} size={40} src={transaction.logoUrl} tint={categoryTint(transaction.category)} />
        <h3 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-[-0.3px] text-text-1 lg:text-xl" id={titleId}>{merchant}</h3>
        <span className={clsx('shrink-0 text-lg font-semibold italic tabular-nums lg:text-xl', transactionAmountClassName(transaction.amount))}>{formatTransactionAmount(transaction.amount)}</span>
      </div>
      {onShowMerchant && merchantName ? (
        <button className="mt-4 text-[13px] text-text-3 hover:text-text-1" onClick={() => onShowMerchant(merchantName)} type="button">
          Show transactions for this merchant →
        </button>
      ) : null}

      {error ? <FormError className="mt-4">{error}</FormError> : null}

      {canWriteTransactions ? (
        <TextField className="mt-4" disabled={isSavingMerchantName} label="Merchant name" onBlur={handleSaveMerchantName} onChange={setMerchantNameDraft} value={merchantNameDraft} />
      ) : null}

      <TransactionDetailsFields
        canWriteTransactions={canWriteTransactions}
        categories={categories}
        isSavingCategory={isSavingCategory}
        onChangeCategory={(category) => applyUpdate({ categoryId: category.id }, setIsSavingCategory)}
        transaction={transaction}
      />

      <div className="mt-7 border-t border-border">
        <DetailToggleRow checked={isHiddenDraft} disabled={togglesDisabled} label="Hidden" onChange={async (value) => { setIsHiddenDraft(value); await saveToggle({ isHidden: value }) }} />
        <DetailToggleRow checked={isRecurringDraft} disabled={togglesDisabled} label="Recurring" onChange={async (value) => { setIsRecurringDraft(value); await saveToggle({ isRecurring: value }) }} />
      </div>

      <div className="mt-4 space-y-4 pt-1">
        <TransactionTagsSection onSetTagIds={(tagIds) => applyUpdate({ tagIds })} transaction={transaction} />
        <div>
          <TextAreaField aria-readonly={!canWriteTransactions} controlClassName={canWriteTransactions ? undefined : 'cursor-not-allowed opacity-70'} disabled={isSavingNotes} id="txn-notes" label="Notes" onBlur={handleSaveNotes} onChange={setNotesDraft} readOnly={!canWriteTransactions} rows={3} value={notesDraft} />
          {isSavingNotes ? <div className="mt-1 text-xs text-text-muted">Saving...</div> : null}
        </div>
        {canWriteTransactions ? (
          <div className="flex justify-end border-t border-border pt-4">
            <Button disabled={isDeleting} onClick={handleDelete} size="sm" variant="danger">{isDeleting ? 'Deleting...' : 'Delete transaction'}</Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
