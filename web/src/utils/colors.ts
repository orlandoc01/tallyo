export const chartPalette = [
  '#4aa3c3',
  '#55a36f',
  '#f3c74f',
  '#f16f3a',
  '#8a55c5',
  '#8bd6ea',
  '#c94891',
  '#4768d4',
  '#bfe86a',
  '#d9a33e',
  '#2f8f83',
  '#ef7b45',
  '#92d9ee',
  '#6b7ee8',
  '#f4a261',
  '#7dbb7c',
  '#d76f88',
  '#71b7ff',
  '#a0d468',
  '#b56576',
]

// tokens.json › chart-palette: institution avatars and generic series.
export const seriesPalette = ['#0d9488', '#2563eb', '#7c3aed', '#f97316', '#06b6d4', '#65a30d', '#db2777', '#475569', '#8b5cf6', '#b45309', '#dc2626', '#0ea5e9']

export function institutionColor(name: string) {
  const hash = [...name].reduce((total, character) => total + character.charCodeAt(0), 0)
  return seriesPalette[hash % seriesPalette.length]
}

export const everythingElseColor = '#8a847d'
export const CASH_FLOW_INCOME_BAR_FILL = '#30a46c'
export const CASH_FLOW_EXPENSE_BAR_FILL = '#E5484D'

export function colorForCategory(categoryId: number | string) {
  const hash = String(categoryId)
    .split('')
    .reduce((total, character) => total + character.charCodeAt(0), 0)

  return chartPalette[hash % chartPalette.length]
}

export function ownerBadgeClassName(owner: string) {
  const colors = ['bg-blue-600', 'bg-emerald-600', 'bg-purple-600', 'bg-amber-600', 'bg-pink-600', 'bg-cyan-700']
  const index = [...owner].reduce((total, character) => total + character.charCodeAt(0), 0) % colors.length

  return colors[index]
}
