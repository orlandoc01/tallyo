import { useRef, useState, type ReactNode } from 'react'
import type { Category, Transaction } from '../../types/graphql'
import { accountDisplayLabel, groupAccountsByInstitution } from '../../utils/accounts'
import { institutionColor } from '../../utils/colors'
import { formatTransactionDatetime } from '../../utils/dates'
import { CategoryTag } from '../common/Tag'
import { CategoryDropdown } from './CategoryDropdown'

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-[11px] uppercase tracking-[0.6px] text-text-muted">{children}</div>
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-text-1">{value}</dd>
    </div>
  )
}

export function TransactionDetailsFields({ canWriteTransactions, categories, isSavingCategory, onChangeCategory, transaction }: {
  canWriteTransactions: boolean
  categories: Category[]
  isSavingCategory: boolean
  onChangeCategory: (category: Category) => void
  transaction: Transaction
}) {
  const [isCategoryOpen, setIsCategoryOpen] = useState(false)
  const categoryButtonRef = useRef<HTMLButtonElement>(null)
  const account = transaction.account
  const institution = groupAccountsByInstitution([account])[0].label

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <Eyebrow>Account</Eyebrow>
          <div className={`mt-1.5 flex items-center gap-2 text-[13px] ${account.closed ? 'text-text-faint' : 'text-text-1'}`}>
            <span aria-hidden className="h-[18px] w-[18px] shrink-0 rounded-full" style={{ backgroundColor: institutionColor(institution) }} />
            <span className="truncate">{accountDisplayLabel(account)}</span>
          </div>
        </div>
        <div className="relative min-w-0">
          <Eyebrow>Category</Eyebrow>
          <div className="mt-1.5">
            <CategoryTag
              category={transaction.category}
              disabled={isSavingCategory}
              label={isSavingCategory ? 'Saving...' : undefined}
              onClick={canWriteTransactions ? () => setIsCategoryOpen((open) => !open) : undefined}
              ref={categoryButtonRef}
            />
          </div>
          <CategoryDropdown
            anchorRef={categoryButtonRef}
            categories={categories}
            isOpen={isCategoryOpen}
            onClose={() => setIsCategoryOpen(false)}
            onSelect={(category) => { setIsCategoryOpen(false); onChangeCategory(category) }}
          />
        </div>
      </div>

      <dl className="mt-5 space-y-3">
        <Field label="Transaction date" value={formatTransactionDatetime(transaction.datetime, 'long')} />
        {transaction.postedDatetime !== transaction.datetime ? <Field label="Posted" value={formatTransactionDatetime(transaction.postedDatetime, 'long')} /> : null}
        {transaction.originalName ? <Field label="Original name" value={transaction.originalName} /> : null}
        <Field label="Owner" value={account.owner.name} />
        {transaction.pending ? <Field label="Status" value="Pending" /> : null}
        {transaction.plaidCategory ? <Field label="Plaid category" value={transaction.plaidCategory} /> : null}
      </dl>
    </>
  )
}
