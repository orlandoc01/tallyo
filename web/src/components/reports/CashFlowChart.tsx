import type { CSSProperties, ReactElement } from 'react'
import { Bar, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useTheme } from '../../hooks/useTheme'
import type { CashFlowPeriod } from '../../types/graphql'
import { chartOpacityForFocus } from '../../utils/chartStyles'
import { formatCurrency, formatSignedCurrency } from '../../utils/currency'
import { Card } from '../common/FormControls'
import { buildCashFlowChartData, formatCashFlowAxisValue, getCashFlowChartDomain, getCashFlowPalette, type CashFlowChartDatum } from './cashFlowChart'
import { reportChartAxes } from './chartAxes'

// Income/expense bar chart with a net line; clicking a period selects it for
// the summary cards and category breakdowns rendered by the page.
export function CashFlowChart({
  periods,
  selectedPeriodIndex,
  onSelectPeriod,
}: {
  periods: CashFlowPeriod[]
  selectedPeriodIndex: number
  onSelectPeriod: (index: number) => void
}) {
  const isMobile = useIsMobile()
  const { isDark } = useTheme()
  const palette = getCashFlowPalette(isDark)
  const chartData = buildCashFlowChartData(periods)
  const chartDomain = getCashFlowChartDomain(chartData)

  return (
    <Card as="section" padded>
      <div className={isMobile ? 'overflow-x-auto' : undefined}>
        <div className="cashflow-chart" style={{
          minWidth: isMobile && chartData.length > 3 ? `${chartData.length * 80}px` : undefined,
          height: isMobile ? 200 : 288,
        }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              barCategoryGap="36.875%"
              data={chartData}
              margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
              onClick={(state) => {
                const idx = state?.activeTooltipIndex
                if (typeof idx === 'number') onSelectPeriod(idx)
              }}
              style={{ cursor: 'pointer' }}
            >
              {reportChartAxes({
                dataKey: 'periodLabel',
                gridStroke: palette.gridStroke,
                vertical: false,
                xAxisProps: { axisLine: false, tick: { fill: palette.axisTickFill, fontSize: isMobile ? 11 : 12 } },
                yAxisFormatter: (value) => formatCashFlowAxisValue(value, isMobile),
                yAxisProps: { axisLine: false, domain: [chartDomain.min, chartDomain.max], tick: { fill: palette.axisTickFill, fontSize: isMobile ? 11 : 12 }, ticks: buildCashFlowAxisTicks(chartDomain) },
                yAxisWidth: isMobile ? 56 : 88,
              })}
              <Tooltip content={(props) => <CashFlowTooltip active={props.active} payload={props.payload} />} />
              <ReferenceLine stroke={palette.zeroLineStroke} strokeWidth={1.5} y={0} />
              {/* Single bar per period; custom shape draws green income (up) and red expense (down) from y=0 */}
              {/* v8 ignore next -- @preserve */}
              <Bar dataKey="income" shape={(props: unknown) => renderCashFlowBar(props as BarShapeProps, palette, selectedPeriodIndex) ?? <g />} />
              <Line
                activeDot={{ fill: palette.netDotFill, r: 5, stroke: palette.netLineStroke, strokeWidth: 2.5 }}
                dataKey="net"
                dot={{ fill: palette.netDotFill, r: 5, stroke: palette.netLineStroke, strokeWidth: 2.5 }}
                name="Net"
                stroke={palette.netLineStroke}
                strokeWidth={3}
                type="monotone"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  )
}

function buildCashFlowAxisTicks(domain: { min: number, max: number }): number[] {
  if (domain.min < 0) {
    return [domain.min, 0, domain.max]
  }

  return [0, domain.max]
}

interface BarShapeProps {
  x: number
  y: number
  width: number
  height: number
  index: number
  payload: CashFlowChartDatum
}

function renderCashFlowBar(
  { x, y, width, height, index, payload }: BarShapeProps,
  palette: ReturnType<typeof getCashFlowPalette>,
  selectedIndex: number,
): ReactElement | null {
  if (!width || !payload || payload.income <= 0) return null

  const { income, expenses } = payload
  // y + height = SVG pixel position of y=0 (income bar spans from income value down to zero)
  const zeroY = y + height
  const r = Math.min(10, width / 2)

  // Income bar: rounded top, flat base at y=0
  const ir = Math.min(r, height / 2)
  const incomePath = `M${x+ir},${y} H${x+width-ir} Q${x+width},${y} ${x+width},${y+ir} V${zeroY} H${x} V${y+ir} Q${x},${y} ${x+ir},${y}Z`

  // Selected bar is fully opaque; others fade back to signal which period is active
  const groupStyle: CSSProperties = {
    opacity: chartOpacityForFocus(index === selectedIndex),
    transition: 'opacity 0.15s ease',
  }

  if (expenses <= 0) {
    return <g style={groupStyle}><path d={incomePath} fill={palette.incomeBarFill} /></g>
  }

  // Expense bar: flat top at y=0, rounded bottom — height proportional to income bar
  const expH = Math.max(Math.round(height * expenses / income), 4)
  const er = Math.min(r, expH / 2)
  const expensePath = `M${x},${zeroY} H${x+width} V${zeroY+expH-er} Q${x+width},${zeroY+expH} ${x+width-er},${zeroY+expH} H${x+er} Q${x},${zeroY+expH} ${x},${zeroY+expH-er}Z`

  return (
    <g style={groupStyle}>
      <path d={incomePath} fill={palette.incomeBarFill} />
      <path d={expensePath} fill={palette.expenseBarFill} />
    </g>
  )
}

function CashFlowTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: CashFlowChartDatum }>
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload!
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-lg">
      <p className="mb-2 font-semibold">{d.periodLabel}</p>
      <p className="mb-1 text-emerald-700">Income : {formatCurrency(d.income)}</p>
      <p className="mb-1 text-red-600">Expenses : {formatCurrency(d.expenses)}</p>
      <p>Net : {formatSignedCurrency(d.net)}</p>
    </div>
  )
}
