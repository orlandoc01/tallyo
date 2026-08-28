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
    <div className="w-full rounded-2xl border border-neutral-200 bg-white p-3 shadow-card">
      <input
        autoFocus={autoFocus}
        className="mb-3 w-full rounded-xl border border-neutral-200 px-3 py-2 text-base outline-none focus:border-brand-500"
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
            <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{groupName}</div>
            {groupCategories.map((category) => (
              <button
                className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-brand-50 ${firstVisibleCategory?.id === category.id ? 'bg-neutral-50' : ''}`}
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
        {groupEntries.length === 0 ? <div className="px-2 py-3 text-sm text-neutral-500">No categories found.</div> : null}
      </div>
    </div>
  )
}
