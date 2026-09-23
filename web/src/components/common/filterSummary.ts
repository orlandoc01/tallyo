export function filterSummary(count: number) {
  return count ? `${count} selected` : 'All'
}

export function selectionSummary(selectedIds: string[], labelById: (id: string) => string | undefined) {
  if (selectedIds.length === 0) return undefined
  if (selectedIds.length > 1) return `${selectedIds.length} selected`
  return labelById(selectedIds[0]) ?? '1 selected'
}
