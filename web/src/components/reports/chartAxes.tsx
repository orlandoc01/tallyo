import type { ComponentProps } from 'react'
import { CartesianGrid, XAxis, YAxis } from 'recharts'

export function reportChartAxes({
  dataKey,
  gridStroke = '#eee',
  vertical,
  xAxisProps,
  yAxisFormatter,
  yAxisProps,
  yAxisWidth,
}: {
  dataKey: string
  gridStroke?: string
  vertical?: boolean
  xAxisProps?: ComponentProps<typeof XAxis>
  yAxisFormatter: (value: number) => string
  yAxisProps?: ComponentProps<typeof YAxis>
  yAxisWidth: number
}) {
  return [
    <CartesianGrid key="grid" stroke={gridStroke} strokeDasharray="4 4" vertical={vertical} />,
    <XAxis dataKey={dataKey} key="x" tickLine={false} {...xAxisProps} />,
    <YAxis key="y" tickFormatter={(value) => yAxisFormatter(Number(value))} tickLine={false} width={yAxisWidth} {...yAxisProps} />,
  ]
}
