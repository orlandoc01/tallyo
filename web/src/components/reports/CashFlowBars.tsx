import clsx from 'clsx'
import type { KeyboardEvent } from 'react'
import { useIsMobile } from '../../hooks/useIsMobile'
import { CASH_FLOW_EXPENSE_BAR_FILL, CASH_FLOW_INCOME_BAR_FILL } from '../../utils/colors'
import { formatCurrencyCompact } from '../../utils/currency'
import type { CashFlowBarDatum, CashFlowSeries } from './cashFlowStats'

interface Geometry {
  width: number
  height: number
  zeroY: number
  x0: number
  step: number
  barWidth: number
  scaleHeight: number
  labelSize: number
  labelGapTop: number
  labelGapBottom: number
  monthSize: number
  monthY: number
}

// Spec deviation: the viewBox is taller than the mock (300/230) so the negative
// band gets the same room as the positive one before the month labels.
// monthY = zeroY + 1 + band + value-label gap + month font size + 6.
const DESKTOP: Geometry = { width: 1000, height: 360, zeroY: 170, x0: 60, step: 160, barWidth: 70, scaleHeight: 150, labelSize: 11, labelGapTop: 8, labelGapBottom: 14, monthSize: 12, monthY: 353 }
const MOBILE: Geometry = { width: 345, height: 276, zeroY: 130, x0: 14, step: 55, barWidth: 30, scaleHeight: 110, labelSize: 9.5, labelGapTop: 6, labelGapBottom: 12, monthSize: 11, monthY: 270 }

const SURFACE = 'rgb(var(--surface))'
const TEXT_2 = 'rgb(var(--text-2))'
const TEXT_3 = 'rgb(var(--text-3))'
const TEXT_1 = 'rgb(var(--text-1))'
const TEXT_MUTED = 'rgb(var(--text-muted))'
const BORDER_EMPH = 'rgb(var(--border-emph))'

// Buckets share the width evenly; the bar sits centred in its slot.
function fitGeometry(base: Geometry, count: number): Geometry {
  const step = (base.width - base.x0 * 2) / Math.max(1, count)
  return { ...base, step, barWidth: Math.min(base.barWidth, step * 0.44) }
}

function slotX(geometry: Geometry, index: number) {
  return geometry.x0 + index * geometry.step + (geometry.step - geometry.barWidth) / 2
}

function stackTotal(stack: { primary: number; secondary: number }) {
  return stack.primary + stack.secondary
}

export function CashFlowBars({ series, selectedIndex, onSelect }: { series: CashFlowSeries; selectedIndex: number; onSelect: (index: number) => void }) {
  const isMobile = useIsMobile()
  const geometry = fitGeometry(isMobile ? MOBILE : DESKTOP, series.bars.length)
  const max = Math.max(1, ...series.bars.flatMap((bar) => [stackTotal(bar.income), stackTotal(bar.expenses)]))
  const scale = geometry.scaleHeight / max
  const centerX = (index: number) => slotX(geometry, index) + geometry.barWidth / 2
  const netPoints = series.bars.map((bar, index) => `${centerX(index)},${geometry.zeroY - bar.net * scale}`).join(' ')

  return (
    <svg aria-label="Cash flow by period" className="cash-flow-bars block h-auto w-full" role="group" viewBox={`0 0 ${geometry.width} ${geometry.height}`}>
      <line stroke={BORDER_EMPH} strokeWidth={1} x1={0} x2={geometry.width} y1={geometry.zeroY} y2={geometry.zeroY} />
      {series.bars.map((bar, index) => (
        <Bar bar={bar} geometry={geometry} index={index} key={bar.label + index} scale={scale} selected={index === selectedIndex} onSelect={() => onSelect(index)} />
      ))}
      <polyline fill="none" points={netPoints} stroke={TEXT_2} strokeDasharray="3 4" strokeWidth={1.5} />
      {series.bars.map((bar, index) => (
        <circle cx={centerX(index)} cy={geometry.zeroY - bar.net * scale} fill={SURFACE} key={bar.label + index} r={3.5} stroke={TEXT_2} strokeWidth={1.5} />
      ))}
    </svg>
  )
}

function Bar({ bar, geometry, index, scale, selected, onSelect }: { bar: CashFlowBarDatum; geometry: Geometry; index: number; scale: number; selected: boolean; onSelect: () => void }) {
  const x = slotX(geometry, index)
  const cx = x + geometry.barWidth / 2
  const incomePrimary = bar.income.primary * scale
  const incomeSecondary = bar.income.secondary * scale
  const expensePrimary = bar.expenses.primary * scale
  const expenseSecondary = bar.expenses.secondary * scale
  const incomeTop = geometry.zeroY - incomePrimary - incomeSecondary
  const expenseBottom = geometry.zeroY + 1 + expensePrimary + expenseSecondary

  function handleKeyDown(event: KeyboardEvent<SVGGElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect()
    }
  }

  return (
    <g aria-label={`Select ${bar.label}`} aria-pressed={selected} className="cursor-pointer outline-none" onClick={onSelect} onKeyDown={handleKeyDown} role="button" tabIndex={0}>
      <rect className="focus-ring" fill="transparent" height={geometry.height - 2} rx={4} width={geometry.step - 2} x={x - (geometry.step - geometry.barWidth) / 2 + 1} y={1} />
      <rect fill={CASH_FLOW_INCOME_BAR_FILL} fillOpacity={0.92} height={incomePrimary} width={geometry.barWidth} x={x} y={geometry.zeroY - incomePrimary} />
      <rect fill={CASH_FLOW_INCOME_BAR_FILL} fillOpacity={0.5} height={incomeSecondary} width={geometry.barWidth} x={x} y={incomeTop} />
      <rect fill={CASH_FLOW_EXPENSE_BAR_FILL} fillOpacity={0.9} height={expensePrimary} width={geometry.barWidth} x={x} y={geometry.zeroY + 1} />
      <rect fill={CASH_FLOW_EXPENSE_BAR_FILL} fillOpacity={0.45} height={expenseSecondary} width={geometry.barWidth} x={x} y={geometry.zeroY + 1 + expensePrimary} />
      {stackTotal(bar.income) > 0 ? <text fill={TEXT_MUTED} fontSize={geometry.labelSize} textAnchor="middle" x={cx} y={incomeTop - geometry.labelGapTop}>{formatCurrencyCompact(stackTotal(bar.income))}</text> : null}
      {stackTotal(bar.expenses) > 0 ? <text fill={TEXT_MUTED} fontSize={geometry.labelSize} textAnchor="middle" x={cx} y={expenseBottom + geometry.labelGapBottom}>{formatCurrencyCompact(stackTotal(bar.expenses))}</text> : null}
      <text className={clsx(selected && 'font-medium')} fill={selected ? TEXT_1 : TEXT_3} fontSize={geometry.monthSize} textAnchor="middle" x={cx} y={geometry.monthY}>{bar.label}</text>
    </g>
  )
}

export function CashFlowLegend({ series }: { series: CashFlowSeries }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-text-2 lg:flex-col lg:gap-2 lg:text-[13px]">
      <span className="hidden font-semibold text-text-1 lg:block">Money in</span>
      <LegendDot color={CASH_FLOW_INCOME_BAR_FILL} label={series.incomeLabel} />
      <LegendDot color={CASH_FLOW_INCOME_BAR_FILL} label="Other income" opacity={0.5} />
      <span className="hidden pt-2 font-semibold text-text-1 lg:block">Money out</span>
      <LegendDot color={CASH_FLOW_EXPENSE_BAR_FILL} label={series.expenseLabel} />
      <LegendDot color={CASH_FLOW_EXPENSE_BAR_FILL} label="Other expenses" opacity={0.45} />
      <span className="inline-flex items-center gap-2 lg:pt-2">
        <span aria-hidden className="inline-block w-3.5 border-t border-dashed border-text-2" />
        Net
      </span>
    </div>
  )
}

function LegendDot({ color, label, opacity = 1 }: { color: string; label: string; opacity?: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color, opacity }} />
      <span className="truncate">{label}</span>
    </span>
  )
}
