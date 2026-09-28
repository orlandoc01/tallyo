import { useMemo } from 'react'
import type { Category } from '../../types/graphql'
import { SheetPickList } from '../common/SheetRows'
import { CategoryTag } from '../common/Tag'

function groupCategories(categories: Category[]) {
  return categories.reduce<Array<{ groupName: string; categories: Category[] }>>((groups, category) => {
    const group = groups.find((item) => item.groupName === category.groupName)
    if (group) group.categories.push(category)
    else groups.push({ groupName: category.groupName, categories: [category] })
    return groups
  }, [])
}

export function CategoryPickList({ categories, noneLabel, onChange, selectedId }: {
  categories: Category[]
  noneLabel?: string
  onChange: (ids: string[]) => void
  selectedId: string
}) {
  const groups = useMemo(() => groupCategories(categories), [categories])
  return (
    <>
      {noneLabel !== undefined ? <SheetPickList options={[{ id: '', label: noneLabel }]} selectedIds={[selectedId]} onChange={onChange} /> : null}
      {groups.map((group) => (
        <div key={group.groupName}>
          <div className="px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.6px] text-text-muted">{group.groupName}</div>
          <SheetPickList
            options={group.categories.map((category) => ({ id: category.id, ariaLabel: category.name, label: <CategoryTag category={category} /> }))}
            selectedIds={[selectedId]}
            onChange={onChange}
          />
        </div>
      ))}
    </>
  )
}
