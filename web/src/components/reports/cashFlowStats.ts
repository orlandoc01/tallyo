import { endOfMonth, format, startOfMonth, startOfYear, subMonths } from 'date-fns'
import type { CashFlowBreakdown, CashFlowPeriod, Granularity } from '../../types/graphql'
import { formatCurrencyCompact } from '../../utils/currency'
import { datePresetHint, selectedDatePreset, type DatePreset, type LocalDateRange as OptionalDateRange } from '../../utils/datePresets'
import { formatDisplayDate, getLastThreePeriodDateRange, toDateInputValue } from '../../utils/dates'
import { ALL_TIME_START } from './dateRangePresets'

export type CashFlowDatePresetId = 'LAST_3_MONTHS' | 'LAST_6_MONTHS' | 'YTD' | 'LAST_12_MONTHS' | 'ALL'
export type LocalDateRange = Required<OptionalDateRange>
export type CashFlowDatePreset = Omit<DatePreset<CashFlowDatePresetId>, 'range'> & { range: (now: Date) => LocalDateRange }

function monthsBack(now: Date, months: number): LocalDateRange {
  return { dateFrom: toDateInputValue(startOfMonth(subMonths(now, months))), dateTo: toDateInputValue(endOfMonth(now)) }
}

export function cashFlowDatePresets(firstDate?: string | null): ReadonlyArray<CashFlowDatePreset> {
  return [
    { id: 'LAST_3_MONTHS', label: 'Last 3 months', range: (now) => monthsBack(now, 2) },
    { id: 'LAST_6_MONTHS', label: 'Last 6 months', range: (now) => monthsBack(now, 5) },
    { id: 'YTD', label: 'Year to date', range: (now) => ({ dateFrom: toDateInputValue(startOfYear(now)), dateTo: toDateInputValue(endOfMonth(now)) }) },
    { id: 'LAST_12_MONTHS', label: 'Last 12 months', range: (now) => monthsBack(now, 11) },
    { id: 'ALL', label: 'All time', range: (now) => ({ dateFrom: firstDate ?? toDateInputValue(ALL_TIME_START), dateTo: toDateInputValue(endOfMonth(now)) }) },
  ]
}

export function cashFlowPresetHint(preset: CashFlowDatePreset, now: Date) {
  return preset.id === 'ALL' ? undefined : datePresetHint(preset.range(now))
}

export function selectedCashFlowPreset(presets: ReadonlyArray<CashFlowDatePreset>, range: LocalDateRange, now: Date) {
  return selectedDatePreset(presets, range, now)
}

export function cashFlowRangeSummary(presets: ReadonlyArray<CashFlowDatePreset>, range: LocalDateRange, now: Date) {
  return selectedCashFlowPreset(presets, range, now)?.label ?? `${formatDisplayDate(range.dateFrom)} – ${formatDisplayDate(range.dateTo)}`
}

export function isDefaultCashFlowRange(range: LocalDateRange, granularity: Granularity, now: Date) {
  const fallback = getLastThreePeriodDateRange(granularity, now)
  return range.dateFrom === fallback.dateFrom && range.dateTo === fallback.dateTo
}

const MONTH_LABEL = /^(\d{4})-(\d{2})$/
const QUARTER_LABEL = /^(\d{4})[- ]Q(\d)$/

export function shortPeriodLabel(periodLabel: string) {
  const month = MONTH_LABEL.exec(periodLabel)
  if (month) return format(new Date(Number(month[1]), Number(month[2]) - 1, 1), 'MMM')
  const quarter = QUARTER_LABEL.exec(periodLabel)
  if (quarter) return `Q${quarter[2]} '${quarter[1].slice(2)}`
  return periodLabel
}

export function granularityUnit(granularity: Granularity) {
  if (granularity === 'QUARTERLY') return 'qtr'
  if (granularity === 'YEARLY') return 'yr'
  return 'mo'
}

export function savingsRatePct(summary: { income: number; expenses: number }) {
  return summary.income ? Math.round(((summary.income - summary.expenses) / summary.income) * 100) : 0
}

export function averageSavingsRate(periods: CashFlowPeriod[]): { pct: number; count: number } {
  const withIncome = periods.filter((period) => period.summary.income > 0)
  const count = withIncome.length
  return { count, pct: count ? Math.round(withIncome.reduce((sum, period) => sum + savingsRatePct(period.summary), 0) / count) : 0 }
}

export function periodSpanLabel(period: Pick<CashFlowPeriod, 'periodStart' | 'periodEnd'>, today: Date) {
  const todayKey = toDateInputValue(today)
  return datePresetHint({ dateFrom: period.periodStart, dateTo: period.periodEnd < todayKey ? period.periodEnd : todayKey })
}

export interface PeriodDelta { changeUSD: number; previousLabel: string }

export function periodDelta(periods: CashFlowPeriod[], index: number, pick: (period: CashFlowPeriod) => number): PeriodDelta | null {
  const previous = periods[index - 1]
  if (!previous) return null
  return { changeUSD: pick(periods[index]) - pick(previous), previousLabel: shortPeriodLabel(previous.periodLabel) }
}

export function deltaText({ changeUSD, previousLabel }: PeriodDelta) {
  const glyph = changeUSD > 0 ? '▲ ' : changeUSD < 0 ? '▼ ' : ''
  return `${glyph}${formatCurrencyCompact(changeUSD)} vs ${previousLabel}`
}

export function deltaTone(changeUSD: number, invert = false) {
  if (changeUSD === 0) return 'text-text-muted'
  return (changeUSD > 0) !== invert ? 'text-positive' : 'text-negative'
}

export interface CashFlowStack { primary: number; secondary: number }
export interface CashFlowBarDatum { label: string; income: CashFlowStack; expenses: CashFlowStack; net: number }
export interface CashFlowSeries { bars: CashFlowBarDatum[]; incomeLabel: string; expenseLabel: string }

function largestCategory(periods: CashFlowPeriod[], pick: (period: CashFlowPeriod) => CashFlowBreakdown[]) {
  const totals = new Map<string, { name: string; total: number }>()
  for (const item of periods.flatMap(pick)) {
    const current = totals.get(item.category.id)
    totals.set(item.category.id, { name: item.category.name, total: (current?.total ?? 0) + Math.abs(item.total) })
  }
  return [...totals.entries()].reduce<{ id: string; name: string; total: number } | null>(
    (best, [id, entry]) => (best && best.total >= entry.total ? best : { id, ...entry }),
    null,
  )
}

function stack(total: number, items: CashFlowBreakdown[], primaryId: string | undefined): CashFlowStack {
  const primary = Math.min(total, Math.abs(items.find((item) => item.category.id === primaryId)?.total ?? 0))
  return { primary, secondary: total - primary }
}

export function buildCashFlowSeries(periods: CashFlowPeriod[]): CashFlowSeries {
  const topIncome = largestCategory(periods, (period) => period.incomeByCategory)
  const topExpense = largestCategory(periods, (period) => period.expensesByCategory)
  return {
    incomeLabel: topIncome?.name ?? 'Income',
    expenseLabel: topExpense?.name ?? 'Expenses',
    bars: periods.map((period) => ({
      label: shortPeriodLabel(period.periodLabel),
      income: stack(Math.abs(period.summary.income), period.incomeByCategory, topIncome?.id),
      expenses: stack(Math.abs(period.summary.expenses), period.expensesByCategory, topExpense?.id),
      net: period.summary.income - period.summary.expenses,
    })),
  }
}
