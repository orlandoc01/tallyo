import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { useAuth } from '../../auth/useAuth'
import type { Category, Transaction } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { formatAccountType } from '../../utils/accountSubtypes'
import { categoryTint } from '../../utils/categoryTint'
import { formatDatetimeAsLocalDate } from '../../utils/dates'
import { Avatar, EmojiAvatar } from '../common/Avatar'
import { checkboxClass } from '../common/FormControls'
import { OwnerDot } from '../common/OwnerDot'
import { TransactionAmount } from '../common/TransactionAmount'
import { CategoryTag, Tag } from '../common/Tag'
import { CategoryDropdown } from './CategoryDropdown'

export interface TransactionRowProps {
  action?: ReactNode
  categories?: Category[]
  hasActionColumn?: boolean
  isBulkMode?: boolean
  isSelected?: boolean
  isUpdatingCategory?: boolean
  onCategoryChange?: (transaction: Transaction, category: Category) => void
  onDetailsOpen?: (transaction: Transaction) => void
  onToggleSelect?: (id: string) => void
  showDate?: boolean
  transaction: Transaction
}

const DESKTOP_GRID = '[grid-template-columns:32px_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.6fr)_24px_110px]'
const DESKTOP_GRID_WITH_ACTION = '[grid-template-columns:32px_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.6fr)_24px_110px_auto]'

function useTransactionRow({ isBulkMode = false, onDetailsOpen, onToggleSelect, transaction }: TransactionRowProps) {
  const { hideOwners } = useAuth()
  const [isCategoryOpen, setIsCategoryOpen] = useState(false)
  const categoryButtonRef = useRef<HTMLButtonElement>(null)
  const merchant = transaction.merchantName || transaction.originalName || 'Unknown merchant'

  function activate() {
    if (isBulkMode && onToggleSelect) onToggleSelect(transaction.id)
    else onDetailsOpen?.(transaction)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.currentTarget === event.target && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      activate()
    }
  }

  return {
    activate,
    categoryButtonRef,
    hideOwners,
    isCategoryOpen,
    merchant,
    onKeyDown,
    rowAriaLabel: isBulkMode ? `Select transaction for ${merchant}` : `View details for ${merchant}`,
    setIsCategoryOpen,
  }
}

function SelectCheckbox({ checked, merchant, onToggle }: { checked: boolean; merchant: string; onToggle?: () => void }) {
  return (
    <input
      aria-label={`Select transaction for ${merchant}`}
      checked={checked}
      className={clsx(checkboxClass, 'h-4 w-4')}
      onChange={onToggle}
      onClick={(event) => event.stopPropagation()}
      type="checkbox"
    />
  )
}

export function TransactionRow(props: TransactionRowProps) {
  const { action, categories, hasActionColumn = false, isBulkMode = false, isSelected = false, isUpdatingCategory = false, onCategoryChange, onToggleSelect, showDate = false, transaction } = props
  const row = useTransactionRow(props)
  const account = transaction.account

  return (
    <div
      aria-label={row.rowAriaLabel}
      className={clsx('grid h-12 w-full cursor-pointer items-center gap-3.5 border-b border-border px-5 text-left transition-colors duration-150 hover:bg-raised', hasActionColumn ? DESKTOP_GRID_WITH_ACTION : DESKTOP_GRID, transaction.isHidden && 'opacity-60')}
      onClick={row.activate}
      onKeyDown={row.onKeyDown}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center">
        {isBulkMode
          ? <SelectCheckbox checked={isSelected} merchant={row.merchant} onToggle={() => onToggleSelect?.(transaction.id)} />
          : <Avatar name={row.merchant} src={transaction.logoUrl} tint={categoryTint(transaction.category)} />}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium text-text-1">{row.merchant}</span>
        {transaction.isHidden ? <Tag>Hidden</Tag> : null}
        {transaction.pending ? <Tag tint="amber">Pending</Tag> : null}
        {showDate ? <span className="shrink-0 text-xs text-text-muted">{formatDatetimeAsLocalDate(transaction.datetime)}</span> : null}
      </div>
      <div className="relative flex min-w-0 items-center">
        {categories && onCategoryChange ? (
          <CategoryTag
            category={transaction.category}
            disabled={isUpdatingCategory}
            label={isUpdatingCategory ? 'Saving...' : undefined}
            onClick={(event) => { event.stopPropagation(); row.setIsCategoryOpen((open) => !open) }}
            ref={row.categoryButtonRef}
          />
        ) : <CategoryTag category={transaction.category} />}
        {categories ? (
          <CategoryDropdown anchorRef={row.categoryButtonRef} categories={categories} isOpen={row.isCategoryOpen} onClose={() => row.setIsCategoryOpen(false)} onSelect={(category) => onCategoryChange?.(transaction, category)} />
        ) : null}
      </div>
      <div className={clsx('truncate text-[13px]', account.closed ? 'text-text-faint' : 'text-text-3')}>
        <span>{accountDisplayLabel(account)}</span>
        <span className="text-text-faint"> · {formatAccountType(account.type)}</span>
      </div>
      <div className="flex items-center">{!row.hideOwners ? <OwnerDot name={account.owner.name} /> : null}</div>
      <div className="text-right"><TransactionAmount amount={transaction.amount} italic /></div>
      {hasActionColumn ? <div className="flex min-w-[76px] items-center justify-end">{action}</div> : null}
    </div>
  )
}

export function MobileTransactionRow(props: TransactionRowProps) {
  const { action, categories, hasActionColumn = false, isBulkMode = false, isSelected = false, isUpdatingCategory = false, onCategoryChange, onToggleSelect, showDate = false, transaction } = props
  const row = useTransactionRow(props)

  return (
    <div
      aria-label={row.rowAriaLabel}
      className={clsx('flex h-[58px] w-full cursor-pointer items-center gap-3 border-b border-border px-4', transaction.isHidden && 'opacity-60')}
      onClick={row.activate}
      onKeyDown={row.onKeyDown}
      role="button"
      tabIndex={0}
    >
      {isBulkMode ? (
        <SelectCheckbox checked={isSelected} merchant={row.merchant} onToggle={() => onToggleSelect?.(transaction.id)} />
      ) : (
        <div className="relative shrink-0">
          <button
            aria-label={`Change category for ${row.merchant}`}
            className="rounded-full disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!categories || !onCategoryChange || isUpdatingCategory}
            onClick={(event) => { event.stopPropagation(); row.setIsCategoryOpen((open) => !open) }}
            ref={row.categoryButtonRef}
            type="button"
          >
            <EmojiAvatar emoji={isUpdatingCategory ? '…' : transaction.category.emoji} tint={categoryTint(transaction.category)} />
          </button>
          {categories ? (
            <CategoryDropdown anchorRef={row.categoryButtonRef} categories={categories} isOpen={row.isCategoryOpen} onClose={() => row.setIsCategoryOpen(false)} onSelect={(category) => onCategoryChange?.(transaction, category)} />
          ) : null}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-1">{row.merchant}</span>
          {transaction.isHidden ? <Tag className="shrink-0">Hidden</Tag> : null}
        </div>
        <div className="truncate text-xs text-text-muted">
          {showDate ? `${formatDatetimeAsLocalDate(transaction.datetime)} · ` : ''}{accountDisplayLabel(transaction.account)}
        </div>
      </div>
      {!row.hideOwners ? <OwnerDot name={transaction.account.owner.name} /> : null}
      <div className="min-w-[64px] text-right"><TransactionAmount amount={transaction.amount} italic /></div>
      {hasActionColumn ? <div className="flex min-w-[76px] items-center justify-end">{action}</div> : null}
    </div>
  )
}
