import { useMemo, useState } from 'react'
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
  const firstVisibleCategory = groupEntries.flatMap(([, groupCategories]) => groupCategories)[0]

  return (
    <div className="w-full">
      <input
        autoFocus={autoFocus}
        className="mb-2 h-8 w-full rounded-md border border-border-strong bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-faint focus:border-brand-600 dark:bg-bg"
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !firstVisibleCategory) return
          event.preventDefault()
          onSelect(firstVisibleCategory)
        }}
        placeholder="Search categories..."
        value={search}
      />
      <div className="max-h-72 overflow-auto">
        {groupEntries.map(([groupName, groupCategories]) => (
          <div className="mb-3" key={groupName}>
            <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-[0.6px] text-text-muted">{groupName}</div>
            {groupCategories.map((category) => (
              <button
                className={`flex h-[34px] w-full items-center gap-2 rounded-[5px] px-2 text-left text-[13px] text-text-1 hover:bg-hover ${firstVisibleCategory?.id === category.id && search ? 'bg-hover' : ''}`}
                key={category.id}
                onClick={() => onSelect(category)}
                type="button"
              >
                <span>{category.emoji}</span>
                <span>{category.name}</span>
              </button>
            ))}
          </div>
        ))}
        {groupEntries.length === 0 ? <div className="px-2 py-3 text-[13px] text-text-muted">No categories found.</div> : null}
      </div>
    </div>
  )
}
