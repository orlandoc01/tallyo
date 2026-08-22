import type { CashFlowPeriod } from '../../types/graphql'
import { CASH_FLOW_EXPENSE_BAR_FILL, CASH_FLOW_INCOME_BAR_FILL } from '../../utils/colors'
import { formatCurrency, formatCurrencyCompact } from '../../utils/currency'

export interface CashFlowChartDatum {
  periodLabel: string
  income: number
  expenses: number
  net: number
}

export function buildCashFlowChartData(periods: CashFlowPeriod[]): CashFlowChartDatum[] {
  return periods.map((period) => ({
    periodLabel: period.periodLabel,
    income: period.summary.income,
    expenses: period.summary.expenses,
    net: period.summary.income - period.summary.expenses,
  }))
}

export function getCashFlowChartDomain(data: CashFlowChartDatum[]): { min: number, max: number } {
  const domain = data.reduce((range, point) => ({
    min: Math.min(range.min, -point.expenses, 0),
    max: Math.max(range.max, point.income, 0),
  }), { min: 0, max: 0 })

  return {
    min: domain.min,
    max: domain.max || 1,
  }
}

export function formatCashFlowAxisValue(value: number, isMobile: boolean): string {
  const formatted = isMobile ? formatCurrencyCompact(Math.abs(value)) : formatCurrency(Math.abs(value))
  return value < 0 ? `-${formatted}` : formatted
}

export function getCashFlowPalette(isDark: boolean) {
  if (!isDark) {
    return {
      axisTickFill: '#78716c',
      incomeBarFill: CASH_FLOW_INCOME_BAR_FILL,
      expenseBarFill: CASH_FLOW_EXPENSE_BAR_FILL,
      incomeBarHoverFill: CASH_FLOW_INCOME_BAR_FILL,
      expenseBarHoverFill: CASH_FLOW_EXPENSE_BAR_FILL,
      incomeBreakdownFill: '#30a46c26',
      expenseBreakdownFill: '#E5484D26',
      incomeBreakdownHoverFill: '#30a46c4C',
      expenseBreakdownHoverFill: '#E5484D4C',
      gridStroke: '#e7e5e4',
      netLineStroke: '#57534e',
      netDotFill: '#fafaf9',
      zeroLineStroke: '#d6d3d1',
    }
  }
  return {
    axisTickFill: '#a8a29e',
    incomeBarFill: CASH_FLOW_INCOME_BAR_FILL,
    expenseBarFill: CASH_FLOW_EXPENSE_BAR_FILL,
    incomeBarHoverFill: CASH_FLOW_INCOME_BAR_FILL,
    expenseBarHoverFill: CASH_FLOW_EXPENSE_BAR_FILL,
    incomeBreakdownFill: '#30a46c26',
    expenseBreakdownFill: '#E5484D26',
    incomeBreakdownHoverFill: '#30a46c4C',
    expenseBreakdownHoverFill: '#E5484D4C',
    gridStroke: '#44403c',
    netLineStroke: '#d6d3d1',
    netDotFill: '#1c1917',
    zeroLineStroke: '#57534e',
  }
}
