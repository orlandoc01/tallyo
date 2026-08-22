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
    <div className="block text-sm font-semibold text-neutral-950">
      <div className={hideLabel ? 'sr-only' : undefined} id={labelId}>{label}</div>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-labelledby={`${labelId} ${valueId}`}
        className={`${hideLabel ? '' : 'mt-2 '}flex w-full items-center justify-between gap-3 rounded-xl border border-neutral-200 px-3 py-2 text-left text-sm outline-none transition focus:border-brand-500 disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={categories.length === 0}
        onClick={() => setIsOpen((current) => !current)}
        ref={buttonRef}
        type="button"
      >
        <span className={`flex min-w-0 items-center gap-2 ${selectedCategory ? 'text-neutral-950' : 'text-neutral-500'}`} id={valueId}>
          {selectedCategory ? (
            <>
              <span>{selectedCategory.emoji}</span>
              <span className="truncate">{selectedCategory.name}</span>
            </>
          ) : (
            <span>{placeholder}</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-500 transition ${isOpen ? 'rotate-180' : ''}`} />
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
