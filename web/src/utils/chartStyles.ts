import type { CSSProperties } from 'react'
import { colorForCategory, everythingElseColor } from './colors'

export const chartMarkOpacity = {
  default: 0.5,
  active: 0.95,
} as const

export const dimmedChartColor = '#d4d4d4'

export const chartFocusOpacityClassName = 'opacity-[var(--chart-opacity)] group-hover:opacity-[var(--chart-focus-opacity)] group-focus-visible:opacity-[var(--chart-focus-opacity)]'

export const chartFocusOpacityVariables = {
  '--chart-opacity': String(chartMarkOpacity.default),
  '--chart-focus-opacity': String(chartMarkOpacity.active),
} as CSSProperties

export function spendingChartColor(id: string | number) {
  return id === 'everything-else' ? everythingElseColor : colorForCategory(id)
}

export function spendingChartFillColor(id: string | number, dimmed: boolean) {
  return dimmed ? dimmedChartColor : spendingChartColor(id)
}

export function chartOpacityForFocus(focused: boolean) {
  return focused ? chartMarkOpacity.active : chartMarkOpacity.default
}
