import { ChevronDown } from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'
import type { Category } from '../../types/graphql'
import { CategoryDropdown } from './CategoryDropdown'

export function CategorySelect({
  categories,
  hideLabel = false,
  label,
  onChange,
  placeholder,
  value,
}: {
  categories: Category[]
  hideLabel?: boolean
  label: string
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const labelId = useId()
  const valueId = useId()
  const selectedCategory = useMemo(() => categories.find((category) => String(category.id) === value) ?? null, [categories, value])

  return (
    <div className="block">
      <div className={hideLabel ? 'sr-only' : 'text-xs text-text-muted'} id={labelId}>{label}</div>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-labelledby={`${labelId} ${valueId}`}
        className={`${hideLabel ? '' : 'mt-1 '}flex h-9 w-full items-center justify-between gap-3 rounded-md border border-border-strong bg-surface px-3 text-left text-[13px] outline-none transition focus:border-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-bg lg:h-8`}
        disabled={categories.length === 0}
        onClick={() => setIsOpen((current) => !current)}
        ref={buttonRef}
        type="button"
      >
        <span className={`flex min-w-0 items-center gap-2 ${selectedCategory ? 'text-text-1' : 'text-text-faint'}`} id={valueId}>
          {selectedCategory ? (
            <>
              <span>{selectedCategory.emoji}</span>
              <span className="truncate">{selectedCategory.name}</span>
            </>
          ) : (
            <span>{placeholder}</span>
          )}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-muted transition ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <CategoryDropdown
        anchorRef={buttonRef}
        categories={categories}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onSelect={(category) => {
          onChange(String(category.id))
          setIsOpen(false)
        }}
      />
    </div>
  )
}
