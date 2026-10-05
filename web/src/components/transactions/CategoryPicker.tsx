import clsx from 'clsx'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { Category } from '../../types/graphql'

export function CategoryPicker({
  autoFocus = true,
  categories,
  onSelect,
}: {
  autoFocus?: boolean
  categories: Category[]
  onSelect: (category: Category) => void
}) {
  const [search, setSearch] = useState('')
  const [highlight, setHighlight] = useState(-1)
  const grouped = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    const filtered = categories.filter((category) => {
      if (!normalizedSearch) return true
      return category.name.toLowerCase().includes(normalizedSearch)
    })
    return filtered.reduce<Record<string, Category[]>>((groups, category) => {
      return { ...groups, [category.groupName]: [...(groups[category.groupName] ?? []), category] }
    }, {})
  }, [categories, search])
  const groupEntries = Object.entries(grouped)
  const visibleCategories = groupEntries.flatMap(([, groupCategories]) => groupCategories)
  const firstIndex = search ? 0 : -1
  const highlightedIndex = Math.min(highlight, visibleCategories.length - 1)
  const highlightedCategory = visibleCategories[highlightedIndex]
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.querySelector('[data-highlighted]')?.scrollIntoView({ block: 'nearest' })
  }, [highlightedCategory?.id])

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setHighlight(Math.min(highlightedIndex + 1, visibleCategories.length - 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        setHighlight(Math.max(highlightedIndex - 1, firstIndex))
        return
      case 'Enter': {
        const category = highlightedCategory ?? visibleCategories[0]
        if (!category) return
        event.preventDefault()
        onSelect(category)
      }
    }
  }

  return (
    <div className="w-full">
      <input
        autoFocus={autoFocus}
        className="mb-2 h-8 w-full rounded-md border border-border-strong bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-faint focus:border-brand-600 dark:bg-bg"
        onChange={(event) => {
          setSearch(event.target.value)
          setHighlight(event.target.value ? 0 : -1)
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search categories..."
        value={search}
      />
      <div className="max-h-72 overflow-auto" ref={listRef}>
        {groupEntries.map(([groupName, groupCategories]) => (
          <div className="mb-3" key={groupName}>
            <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-[0.6px] text-text-muted">{groupName}</div>
            {groupCategories.map((category) => {
              const isHighlighted = highlightedCategory?.id === category.id
              return (
                <button
                  aria-current={isHighlighted || undefined}
                  className={clsx('flex h-[34px] w-full items-center gap-2 rounded-[5px] px-2 text-left text-[13px] text-text-1 hover:bg-hover', isHighlighted && 'bg-hover')}
                  data-highlighted={isHighlighted ? '' : undefined}
                  key={category.id}
                  onClick={() => onSelect(category)}
                  type="button"
                >
                  <span>{category.emoji}</span>
                  <span>{category.name}</span>
                </button>
              )
            })}
          </div>
        ))}
        {groupEntries.length === 0 ? <div className="px-2 py-3 text-[13px] text-text-muted">No categories found.</div> : null}
      </div>
    </div>
  )
}
