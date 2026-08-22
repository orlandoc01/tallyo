export type ComparisonMode =
  | 'month-vs-last-month'
  | 'month-vs-last-year'
  | 'year-vs-last-year'
  | 'week-vs-last-week'

export interface ComparisonPoint {
  label: string
  current: number | null
  historical: number | null
}

export function formatPositionLabel(index: number, mode: ComparisonMode): string {
  if (mode === 'week-vs-last-week') {
    return (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const)[index] ?? `Day ${index + 1}`
  }
  if (mode === 'year-vs-last-year') {
    return `Day ${index * 7 + 1}`
  }
  return `Day ${index + 1}`
}

export function buildComparisonPoints(
  currentPeriods: { totalAmount: number }[],
  historicalPeriods: { totalAmount: number }[],
  mode: ComparisonMode,
  todayIndex: number,
): ComparisonPoint[] {
  const maxLen = Math.max(currentPeriods.length, historicalPeriods.length)
  let currentCum = 0
  let historicalCum = 0
  return Array.from({ length: maxLen }, (_, i) => {
    currentCum += currentPeriods[i]?.totalAmount ?? 0
    historicalCum += historicalPeriods[i]?.totalAmount ?? 0
    return {
      label: formatPositionLabel(i, mode),
      current: i <= todayIndex ? currentCum : null,
      historical: i < historicalPeriods.length ? historicalCum : null,
    }
  })
}
