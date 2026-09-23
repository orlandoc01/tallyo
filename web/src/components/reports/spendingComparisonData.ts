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

// Labels at the given fractions of the series, deduplicated, so short series
// (a week) still get every day and long ones get evenly spaced ticks.
export function comparisonTickLabels(points: ComparisonPoint[], fractions: number[]): string[] {
  const n = points.length
  if (n === 0) return []
  if (n <= fractions.length + 1) return points.map((point) => point.label)
  return [...new Set(fractions.map((fraction) => Math.min(Math.round((n - 1) * fraction), n - 1)))].map((index) => points[index].label)
}
