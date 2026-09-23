import type { AssetClassifier, LiabilityCategory } from '../types/graphql'
import { colorForCategory, everythingElseColor } from './colors'

// tokens.json › asset-class-colors
export const assetClassColors: Record<AssetClassifier, string> = {
  CASH: '#30a46c',
  PUBLIC: '#3e63dd',
  COMPANY_EQUITY: '#8e4ec6',
  CRYPTOCURRENCY: '#f59e0b',
  STABLECOIN: '#12a594',
  REAL_ESTATE: '#e5484d',
}

export const liabilityColors: Record<LiabilityCategory, string> = {
  MORTGAGE: '#f76b15',
  CARD: '#ffb224',
  LOAN: '#e5484d',
  OTHER: '#8a847d',
}

export const chartTheme = {
  grid: { stroke: 'rgb(var(--hover))', strokeDasharray: '2 4' },
  baseline: { stroke: 'rgb(var(--border-emph))', strokeWidth: 1 },
  axisTick: { fill: 'rgb(var(--text-muted))', fontSize: 11 },
  axisTickX: { fill: 'rgb(var(--text-3))', fontSize: 12 },
  line: { strokeWidth: 1.5 },
  dot: { r: 3.5, fill: 'rgb(var(--surface))', strokeWidth: 1.5 },
  tooltip: { backgroundColor: 'rgb(var(--raised))', border: '1px solid rgb(var(--border-strong))', borderRadius: 6, padding: '6px 10px', boxShadow: '0 4px 12px rgba(0,0,0,.4)' },
} as const

export function spendingChartColor(id: string | number) {
  return id === 'everything-else' ? everythingElseColor : colorForCategory(id)
}

export const CHART_CURSOR = { stroke: 'rgb(var(--text-faint))', strokeDasharray: '3 3' }
export const CHART_SURFACE = 'rgb(var(--surface))'

// Mobile scrub: the Recharts wrapper is pinned at the origin and the content
// places itself above the point, clamped to 15–85% of the chart width.
export function mobileTooltipProps(isMobile: boolean) {
  return { wrapperStyle: { outline: 'none' }, ...(isMobile ? { position: { x: 0, y: 0 }, allowEscapeViewBox: { x: true, y: true } } : {}) }
}

export function clampTooltipX(x: number, width: number) {
  return Math.min(Math.max(x, width * 0.15), width * 0.85)
}
