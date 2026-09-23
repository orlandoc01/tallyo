export function nextSelectedIds(selectedIds: string[], id: string, checked: boolean, selectionMode: 'multi' | 'single') {
  if (selectionMode === 'single') {
    return checked ? [id] : []
  }
  const selected = new Set(selectedIds)
  if (checked) selected.add(id)
  else selected.delete(id)
  return [...selected]
}

export function nextGroupSelectedIds(selectedIds: string[], optionIds: string[], checked: boolean) {
  const selected = new Set(selectedIds)
  for (const id of optionIds) {
    if (checked) selected.add(id)
    else selected.delete(id)
  }
  return [...selected]
}

export function toggleSelectedIds<T extends string>(selectedIds: T[], ids: T[]): T[] {
  if (ids.length === 0) return selectedIds
  const toggled = new Set(ids)
  if (ids.every((id) => selectedIds.includes(id))) return selectedIds.filter((id) => !toggled.has(id))
  return [...selectedIds, ...ids.filter((id) => !selectedIds.includes(id))]
}

export function allSelected(selectedIds: string[], ids: string[]) {
  return ids.length > 0 && ids.every((id) => selectedIds.includes(id))
}
