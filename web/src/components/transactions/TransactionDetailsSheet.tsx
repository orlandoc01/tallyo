import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useMutation } from 'urql'
import { DELETE_TRANSACTION_MUTATION, UPDATE_TRANSACTION_MUTATION } from '../../graphql/mutations'
import { useAccounts, useCategoryGroups, useTags } from '../../hooks/useEntityQueries'
import { usePermissions } from '../../hooks/usePermissions'
import type { Category, Transaction, TransactionUpdates } from '../../types/graphql'
import { accountDisplayLabel, accountInstitutionLabel } from '../../utils/accounts'
import { categoryTint } from '../../utils/categoryTint'
import { institutionColor } from '../../utils/colors'
import { formatCurrency, formatTransactionAmount, transactionAmountClassName } from '../../utils/currency'
import { formatDatetimeAsLocalDate, formatTransactionDatetime } from '../../utils/dates'
import { sameIds } from '../../utils/selection'
import { Avatar } from '../common/Avatar'
import { Button } from '../common/Button'
import { FormError } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetFoot, SheetHero } from '../common/SheetHero'
import { SheetAccordionRow, SheetActionRow, SheetField, SheetPickList, SheetStaticRow, SheetToggleRow } from '../common/SheetRows'
import { CategoryTag } from '../common/Tag'
import { CreateRuleModal } from './CreateRuleModal'
import type { TransactionDetailsPaneProps } from './TransactionDetailsPane'

type Section = 'merchant' | 'category' | 'notes' | 'tags'

interface Draft {
  categoryId: string
  isHidden: boolean
  isRecurring: boolean
  merchantName: string
  notes: string
  tagIds: string[]
}

function draftFromTransaction(transaction: Transaction): Draft {
  return {
    categoryId: transaction.category.id,
    isHidden: transaction.isHidden,
    isRecurring: transaction.isRecurring,
    merchantName: transaction.merchantName ?? '',
    notes: transaction.notes ?? '',
    tagIds: transaction.tags.map((tag) => tag.id),
  }
}

function stagedUpdates(base: Draft, draft: Draft): TransactionUpdates {
  return {
    ...(draft.merchantName !== base.merchantName ? { merchantName: draft.merchantName || null } : {}),
    ...(draft.notes !== base.notes ? { notes: draft.notes || null } : {}),
    ...(draft.categoryId !== base.categoryId ? { categoryId: draft.categoryId } : {}),
    ...(sameIds(draft.tagIds, base.tagIds) ? {} : { tagIds: draft.tagIds }),
    ...(draft.isHidden !== base.isHidden ? { isHidden: draft.isHidden } : {}),
    ...(draft.isRecurring !== base.isRecurring ? { isRecurring: draft.isRecurring } : {}),
  }
}

function groupCategories(categories: Category[]) {
  return categories.reduce<Array<{ groupName: string; categories: Category[] }>>((groups, category) => {
    const group = groups.find((item) => item.groupName === category.groupName)
    if (group) group.categories.push(category)
    else groups.push({ groupName: category.groupName, categories: [category] })
    return groups
  }, [])
}

// Fetches the rule form's lookups only once the modal is actually opened.
function CreateRuleLauncher({ merchantName, onClose }: { merchantName: string | null | undefined; onClose: () => void }) {
  const { accounts } = useAccounts()
  const { categoryGroups } = useCategoryGroups()
  return <CreateRuleModal accounts={accounts} categoryGroups={categoryGroups} filter={{ merchantPrefix: merchantName ?? undefined }} onClose={onClose} />
}

// Mobile transaction details: every edit is staged in a local draft and
// committed with one UpdateTransaction mutation on Save.
export function TransactionDetailsSheet({ categories, onClose, onDelete, onShowMerchant, onUpdate, titleId, transaction }: TransactionDetailsPaneProps) {
  const [, updateTransaction] = useMutation(UPDATE_TRANSACTION_MUTATION)
  const [, deleteTransaction] = useMutation(DELETE_TRANSACTION_MUTATION)
  const { tags } = useTags()
  const { canWrite } = usePermissions()
  const canWriteTransactions = canWrite('transactions')
  const [draft, setDraft] = useState(() => draftFromTransaction(transaction))
  const [open, setOpen] = useState<Section | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [isCreateRuleOpen, setIsCreateRuleOpen] = useState(false)

  const merchant = transaction.merchantName || transaction.originalName || 'Unknown merchant'
  const merchantName = transaction.merchantName
  const account = transaction.account
  const institution = accountInstitutionLabel(account)
  const categoryGroups = useMemo(() => groupCategories(categories), [categories])
  const base = draftFromTransaction(transaction)
  const updates = stagedUpdates(base, draft)
  const selectedCategory = categories.find((category) => category.id === draft.categoryId) ?? transaction.category
  const selectedTagNames = tags.filter((tag) => draft.tagIds.includes(tag.id)).map((tag) => tag.name)
  const toggle = (section: Section) => () => setOpen((current) => current === section ? null : section)
  const patch = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }))

  async function handleSave() {
    if (!canWriteTransactions || Object.keys(updates).length === 0) return onClose()
    setBusy(true)
    setError(null)
    const result = await updateTransaction({ input: { id: transaction.id, updates } })
    setBusy(false)
    if (result.error) return setError(result.error.message)
    if (result.data?.updateTransaction?.transaction) onUpdate?.(result.data.updateTransaction.transaction)
    onClose()
  }

  async function handleDelete() {
    if (!window.confirm(`Delete ${merchant}? This cannot be undone.`)) return
    setBusy(true)
    setError(null)
    const result = await deleteTransaction({ id: transaction.id })
    setBusy(false)
    if (result.error) return setError(result.error.message)
    if (result.data?.deleteTransaction?.success) return onDelete?.(transaction.id)
    setError('Transaction was not found.')
  }

  return (
    <MobileSheet
      action={canWriteTransactions ? <Button className="touch-manipulation" onClick={() => setIsCreateRuleOpen(true)} size="sm" variant="ghost">Create rule</Button> : undefined}
      bodyClassName="pb-2"
      footer={<MobileFilterFooter primaryDisabled={busy} primaryLabel={canWriteTransactions ? (busy ? 'Saving...' : 'Save') : 'Done'} onPrimary={() => { void handleSave() }} />}
      hideClose
      labelledBy={titleId ?? 'transaction-details-title'}
      maxHeight="84%"
      onClose={onClose}
      title="Details"
    >
      <div aria-label={`Details for ${merchant}`} role="region">
        <SheetHero
          avatar={<Avatar name={merchant} size={40} src={transaction.logoUrl} tint={categoryTint(transaction.category)} />}
          sub={`${accountDisplayLabel(account)} · ${formatTransactionDatetime(transaction.datetime)}`}
          title={merchant}
          value={formatTransactionAmount(transaction.amount)}
          valueClassName={clsx('italic', transactionAmountClassName(transaction.amount))}
        />
        {onShowMerchant && merchantName ? (
          <button className="mb-3 text-[13px] text-text-3" onClick={() => onShowMerchant(merchantName)} type="button">
            Show transactions for this merchant →
          </button>
        ) : null}
        {error ? <FormError className="mb-3">{error}</FormError> : null}

        {canWriteTransactions
          ? <SheetField changed={draft.merchantName !== base.merchantName} expanded={open === 'merchant'} label="Merchant" onChange={(merchantName) => patch({ merchantName })} onToggle={toggle('merchant')} placeholder="Merchant name" value={draft.merchantName} />
          : <SheetStaticRow label="Merchant" value={transaction.merchantName || '—'} />}
        {transaction.originalName ? <SheetStaticRow label="Original name" value={transaction.originalName} /> : null}
        <SheetStaticRow label="Amount" value={formatCurrency(transaction.amount)} />
        <SheetStaticRow label="Authorized" value={formatTransactionDatetime(transaction.datetime, 'long')} />
        {transaction.postedDatetime !== transaction.datetime ? <SheetStaticRow label="Posted" value={formatTransactionDatetime(transaction.postedDatetime, 'long')} /> : null}
        <SheetStaticRow
          label="Account"
          value={(
            <span className={clsx('inline-flex items-center gap-2', account.closed && 'text-text-faint')}>
              <span aria-hidden className="h-5 w-5 shrink-0 rounded-full" style={{ backgroundColor: institutionColor(institution) }} />
              {accountDisplayLabel(account)}
            </span>
          )}
        />
        <SheetStaticRow label="Owner" value={account.owner.name} />
        <SheetAccordionRow changed={draft.categoryId !== base.categoryId} expanded={open === 'category'} label="Category" onToggle={toggle('category')} summary={<CategoryTag category={selectedCategory} />}>
          {canWriteTransactions ? categoryGroups.map((group) => (
            <div key={group.groupName}>
              <div className="px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.6px] text-text-muted">{group.groupName}</div>
              <SheetPickList
                options={group.categories.map((category) => ({ id: category.id, ariaLabel: category.name, label: <CategoryTag category={category} /> }))}
                selectedIds={[draft.categoryId]}
                onChange={([categoryId]) => { patch({ categoryId }); setOpen(null) }}
              />
            </div>
          )) : <p className="px-2.5 text-[13px] text-text-muted">Read only.</p>}
        </SheetAccordionRow>
        <SheetStaticRow label="Status" value={transaction.pending ? 'Pending' : 'Posted'} />
        <SheetStaticRow label="Reviewed" value={transaction.isReviewed ? 'Yes' : 'No'} />
        {transaction.plaidCategory ? <SheetStaticRow label="Plaid category" value={transaction.plaidCategory} /> : null}
        <SheetField changed={draft.notes !== base.notes} disabled={!canWriteTransactions} expanded={open === 'notes'} label="Notes" multiline onChange={(notes) => patch({ notes })} onToggle={toggle('notes')} placeholder="Add a note" value={draft.notes} />
        <SheetAccordionRow changed={!sameIds(draft.tagIds, base.tagIds)} expanded={open === 'tags'} label="Tags" onToggle={toggle('tags')} summary={selectedTagNames.length ? selectedTagNames.join(', ') : <span className="text-text-muted">+ Tags</span>}>
          <SheetPickList
            options={tags.map((tag) => ({ id: tag.id, ariaLabel: tag.name, label: tag.name, leading: <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} /> }))}
            selectedIds={draft.tagIds}
            selectionMode="multi"
            onChange={canWriteTransactions ? (tagIds) => patch({ tagIds }) : () => {}}
          />
        </SheetAccordionRow>

        <SheetToggleRow checked={draft.isHidden} disabled={!canWriteTransactions} label="Hidden" onChange={(isHidden) => patch({ isHidden })} />
        <SheetToggleRow checked={draft.isRecurring} disabled={!canWriteTransactions} label="Recurring" onChange={(isRecurring) => patch({ isRecurring })} />

        <SheetFoot rows={[{ k: 'Transaction ID', v: transaction.id, mono: true }, { k: 'Created', v: formatDatetimeAsLocalDate(transaction.createdAt) }]} />

        {canWriteTransactions ? <SheetActionRow destructive disabled={busy} label="Delete transaction" onClick={() => { void handleDelete() }} /> : null}
      </div>

      {isCreateRuleOpen ? <CreateRuleLauncher merchantName={merchantName} onClose={() => setIsCreateRuleOpen(false)} /> : null}
    </MobileSheet>
  )
}
