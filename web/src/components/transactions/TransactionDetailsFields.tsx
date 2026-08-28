import { useRef, useState } from 'react'
import type { Category, Transaction } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { formatTransactionDatetime } from '../../utils/dates'
import { formatTransactionAmount, transactionAmountClassName } from '../../utils/currency'
import { TextField } from '../common/FormControls'
import { CategoryDropdown } from './CategoryDropdown'

export function TransactionDetailsFields({
  canWriteTransactions,
  categories,
  isSavingCategory,
  isSavingMerchantName,
  onChangeCategory,
  onChangeMerchantName,
  onSaveMerchantName,
  merchantNameDraft,
  transaction,
}: {
  canWriteTransactions: boolean
  categories: Category[]
  isSavingCategory: boolean
  isSavingMerchantName: boolean
  onChangeCategory: (category: Category) => void
  onChangeMerchantName: (merchantName: string) => void
  onSaveMerchantName: () => void
  merchantNameDraft: string
  transaction: Transaction
}) {
  const [isCategoryOpen, setIsCategoryOpen] = useState(false)
  const categoryButtonRef = useRef<HTMLButtonElement>(null)
  const merchant = transaction.merchantName || transaction.originalName || 'Unknown merchant'

  return (
    <dl className="space-y-3 text-sm">
      <div className="flex justify-between">
        <dt className="text-neutral-500">Merchant</dt>
        <dd className="w-1/2 font-medium">
          {canWriteTransactions ? (
            <TextField
              disabled={isSavingMerchantName}
              hideLabel
              label="Merchant name"
              onBlur={onSaveMerchantName}
              onChange={onChangeMerchantName}
              value={merchantNameDraft}
            />
          ) : merchant}
        </dd>
      </div>

      {transaction.originalName && transaction.originalName !== transaction.merchantName && (
        <div className="flex justify-between">
          <dt className="text-neutral-500">Original name</dt>
          <dd className="font-medium">{transaction.originalName}</dd>
        </div>
      )}

      <div className="flex justify-between">
        <dt className="text-neutral-500">Amount</dt>
        <dd className={transactionAmountClassName(transaction.amount)}>{formatTransactionAmount(transaction.amount)}</dd>
      </div>

      <div className="flex justify-between">
        <dt className="text-neutral-500">Authorized</dt>
        <dd className="font-medium">{formatTransactionDatetime(transaction.datetime)}</dd>
      </div>
      {transaction.postedDatetime !== transaction.datetime && (
        <div className="flex justify-between">
          <dt className="text-neutral-500">Posted</dt>
          <dd className="font-medium">{formatTransactionDatetime(transaction.postedDatetime)}</dd>
        </div>
      )}

      <div className="flex justify-between">
        <dt className="text-neutral-500">Account</dt>
        <dd className={transaction.account.closed ? 'font-medium text-neutral-400' : 'font-medium'}>
          {accountDisplayLabel(transaction.account)}
        </dd>
      </div>

      <div className="flex justify-between">
        <dt className="text-neutral-500">Owner</dt>
        <dd className="font-medium">{transaction.account.owner.name}</dd>
      </div>

      <div className="flex justify-between">
        <dt className="text-neutral-500">Category</dt>
        <dd className="relative font-medium">
          <button
            aria-expanded={isCategoryOpen}
            className="inline-flex items-center gap-1 rounded-xl px-2 py-1 hover:bg-neutral-100"
            disabled={isSavingCategory}
            onClick={() => setIsCategoryOpen((open) => !open)}
            ref={categoryButtonRef}
            type="button"
          >
            {isSavingCategory ? (
              <span className="text-neutral-400">Saving...</span>
            ) : (
              <>
                <span>{transaction.category.emoji}</span>
                <span>{transaction.category.name}</span>
              </>
            )}
          </button>
          <CategoryDropdown
            anchorRef={categoryButtonRef}
            categories={categories}
            isOpen={isCategoryOpen}
            onClose={() => setIsCategoryOpen(false)}
            onSelect={(category) => {
              setIsCategoryOpen(false)
              onChangeCategory(category)
            }}
          />
        </dd>
      </div>

      <div className="flex justify-between">
        <dt className="text-neutral-500">Status</dt>
        <dd className="font-medium">{transaction.pending ? 'Pending' : 'Posted'}</dd>
      </div>

      <div className="flex justify-between">
        <dt className="text-neutral-500">Reviewed</dt>
        <dd className="font-medium">{transaction.isReviewed ? 'Yes' : 'No'}</dd>
      </div>

      {transaction.plaidCategory && (
        <div className="flex justify-between">
          <dt className="shrink-0 text-neutral-500">Plaid category</dt>
          <dd className="max-w-[50%] truncate min-w-0 font-medium" title={transaction.plaidCategory}>
            {transaction.plaidCategory}
          </dd>
        </div>
      )}
    </dl>
  )
}
