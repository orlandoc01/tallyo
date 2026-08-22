import { useRef, useState } from 'react'
import clsx from 'clsx'
import { useAuth } from '../../auth/useAuth'
import type { Category, Transaction } from '../../types/graphql'
import { formatDatetimeAsLocalDate } from '../../utils/dates'
import { formatTransactionAmount, transactionAmountClassName } from '../../utils/currency'
import { ownerBadgeClassName } from '../../utils/colors'
import { accountDisplayLabel } from '../../utils/accounts'
import { CategoryDropdown } from './CategoryDropdown'

export interface TransactionRowProps {
  categories?: Category[]
  isBulkMode?: boolean
  isSelected?: boolean
  isUpdatingCategory?: boolean
  onCategoryChange?: (transaction: Transaction, category: Category) => void
  onDetailsOpen?: (transaction: Transaction) => void
  onToggleSelect?: (id: string) => void
  showDate?: boolean
  transaction: Transaction
}

function useTransactionRowBase(transaction: Transaction) {
  const { hideOwners } = useAuth()
  const merchant = transaction.merchantName || transaction.originalName || 'Unknown merchant'
  const owner = transaction.account.owner.name.toLowerCase()
  const [isCategoryOpen, setIsCategoryOpen] = useState(false)
  const categoryButtonRef = useRef<HTMLButtonElement>(null)

  return { categoryButtonRef, hideOwners, isCategoryOpen, merchant, owner, ownerColor: ownerBadgeClassName(owner), setIsCategoryOpen }
}

export function TransactionRow({
  categories,
  isBulkMode = false,
  isSelected = false,
  isUpdatingCategory = false,
  onCategoryChange,
  onDetailsOpen,
  onToggleSelect,
  showDate = false,
  transaction,
}: TransactionRowProps) {
  const [brokenLogoUrl, setBrokenLogoUrl] = useState<string | null>(null)
  const { categoryButtonRef, hideOwners, isCategoryOpen, merchant, owner, ownerColor, setIsCategoryOpen } = useTransactionRowBase(transaction)
  const logoUrl = transaction.logoUrl

  return (
    <tr
      className={clsx('cursor-pointer border-b border-neutral-100 bg-white text-sm hover:bg-neutral-50', transaction.isHidden && 'opacity-60')}
      onClick={() => {
        if (isBulkMode && onToggleSelect) {
          onToggleSelect(transaction.id)
        } else {
          onDetailsOpen?.(transaction)
        }
      }}
    >
      {isBulkMode ? (
        <td className="w-10 px-2 py-3">
          <input
            aria-label={`Select transaction for ${merchant}`}
            checked={isSelected}
            className="h-4 w-4 rounded accent-brand-600"
            onChange={() => onToggleSelect?.(transaction.id)}
            onClick={(event) => event.stopPropagation()}
            type="checkbox"
          />
        </td>
      ) : null}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {logoUrl && brokenLogoUrl !== logoUrl ? (
            <img alt={merchant} className="h-8 w-8 rounded-full object-contain" onError={() => setBrokenLogoUrl(logoUrl)} src={logoUrl} />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-xs font-bold">{merchant.charAt(0)}</span>
          )}
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-medium text-neutral-950">{merchant}</span>
              {transaction.isHidden && (
                <span className="rounded-full border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-500">
                  Hidden
                </span>
              )}
            </div>
            {showDate ? <span className="text-xs text-neutral-400">{formatDatetimeAsLocalDate(transaction.datetime)}</span> : null}
          </div>
        </div>
      </td>
      <td className="relative w-48 px-4 py-3 text-neutral-700">
        {categories && onCategoryChange ? (
          <button
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 whitespace-nowrap hover:bg-neutral-100"
            disabled={isUpdatingCategory}
            onClick={(event) => {
              event.stopPropagation()
              setIsCategoryOpen((open) => !open)
            }}
            ref={categoryButtonRef}
            type="button"
          >
            {isUpdatingCategory ? (
              <span className="text-neutral-400">Saving...</span>
            ) : (
              <>
                <span>{transaction.category.emoji}</span>
                <span className="whitespace-nowrap">{transaction.category.name}</span>
              </>
            )}
          </button>
        ) : (
          `${transaction.category.emoji} ${transaction.category.name}`
        )}
        {categories && (
          <CategoryDropdown
            anchorRef={categoryButtonRef}
            categories={categories}
            isOpen={isCategoryOpen}
            onClose={() => setIsCategoryOpen(false)}
            onSelect={(category) => onCategoryChange?.(transaction, category)}
          />
        )}
      </td>
      <td className="hidden px-4 py-3 text-neutral-700 md:table-cell">
        <span className={transaction.account.closed ? 'text-neutral-400' : ''}>
          {accountDisplayLabel(transaction.account)}
        </span>
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        {!hideOwners ? <span className={clsx('rounded-full px-2 py-1 text-xs font-bold text-white', ownerColor)}>{owner.charAt(0)}</span> : null}
      </td>
      <td className="px-4 py-3 text-right font-semibold">
        <span className={transactionAmountClassName(transaction.amount)}>{formatTransactionAmount(transaction.amount)}</span>
      </td>
    </tr>
  )
}

export function MobileTransactionRow({
  categories,
  isBulkMode = false,
  isSelected = false,
  isUpdatingCategory = false,
  onCategoryChange,
  onDetailsOpen,
  onToggleSelect,
  showDate = false,
  transaction,
}: TransactionRowProps) {
  const { categoryButtonRef, hideOwners, isCategoryOpen, merchant, owner, ownerColor, setIsCategoryOpen } = useTransactionRowBase(transaction)

  return (
    <div
      aria-label={isBulkMode ? `Select transaction for ${merchant}` : `View details for ${merchant}`}
      className={clsx(
        'flex w-full cursor-pointer items-center gap-3 border-b border-neutral-100 bg-white px-4 py-3',
        transaction.isHidden && 'opacity-60',
      )}
      onClick={() => {
        if (isBulkMode && onToggleSelect) {
          onToggleSelect(transaction.id)
        } else {
          onDetailsOpen?.(transaction)
        }
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.currentTarget === e.target && (e.key === 'Enter' || e.key === ' ')) {
          if (isBulkMode && onToggleSelect) {
            onToggleSelect(transaction.id)
          } else {
            onDetailsOpen?.(transaction)
          }
        }
      }}
    >
      {isBulkMode ? (
        <input
          aria-label={`Select transaction for ${merchant}`}
          checked={isSelected}
          className="h-4 w-4 shrink-0 rounded accent-brand-600"
          onChange={() => onToggleSelect?.(transaction.id)}
          onClick={(e) => e.stopPropagation()}
          type="checkbox"
        />
      ) : null}
      <div className="relative shrink-0">
        <button
          aria-label={`Change category for ${merchant}`}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-base disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!categories || !onCategoryChange || isUpdatingCategory}
          onClick={(event) => {
            event.stopPropagation()
            setIsCategoryOpen((open) => !open)
          }}
          ref={categoryButtonRef}
          type="button"
        >
          {isUpdatingCategory ? <span className="text-xs text-neutral-400">...</span> : transaction.category.emoji}
        </button>
        {categories ? (
          <CategoryDropdown
            anchorRef={categoryButtonRef}
            categories={categories}
            isOpen={isCategoryOpen}
            onClose={() => setIsCategoryOpen(false)}
            onSelect={(category) => onCategoryChange?.(transaction, category)}
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-neutral-950">{merchant}</span>
          {transaction.isHidden && (
            <span className="shrink-0 rounded-full border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-500">
              Hidden
            </span>
          )}
        </div>
        {showDate ? <div className="text-xs text-neutral-400">{transaction.datetime?.slice(0, 10)}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!hideOwners ? (
          <span className={clsx('rounded-full px-2 py-0.5 text-xs font-bold text-white', ownerColor)}>
            {owner.charAt(0).toUpperCase()}
          </span>
        ) : null}
        <span className={clsx('text-sm font-semibold tabular-nums', transactionAmountClassName(transaction.amount))}>
          {formatTransactionAmount(transaction.amount)}
        </span>
      </div>
    </div>
  )
}
