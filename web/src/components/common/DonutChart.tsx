import type { ReactNode } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { chartOpacityForFocus, dimmedChartColor } from '../../utils/chartStyles'

interface DonutChartSlice {
  key: string
  label: string
  value: number
  color: string
  dimmed?: boolean
  selected?: boolean
  disabled?: boolean
}

export function DonutChart({
  children,
  innerRadius,
  onSliceClick,
  onSliceMouseEnter,
  onSliceMouseLeave,
  outerRadius,
  paddingAngle,
  slices,
}: {
  children?: ReactNode
  innerRadius: string
  onSliceClick?: (slice: DonutChartSlice) => void
  onSliceMouseEnter?: (slice: DonutChartSlice) => void
  onSliceMouseLeave?: (slice: DonutChartSlice) => void
  outerRadius: string
  paddingAngle: number
  slices: DonutChartSlice[]
}) {
  return (
    <ResponsiveContainer height="100%" width="100%">
      <PieChart>
        <Pie data={slices} dataKey="value" innerRadius={innerRadius} nameKey="label" outerRadius={outerRadius} paddingAngle={paddingAngle} stroke="none" strokeWidth={0}>
          {slices.map((slice) => {
            const interactive = !slice.disabled && Boolean(onSliceClick || onSliceMouseEnter || onSliceMouseLeave)

            return (
              <Cell
                className={interactive ? 'cursor-pointer outline-none' : 'outline-none'}
                fill={slice.dimmed ? dimmedChartColor : slice.color}
                fillOpacity={chartOpacityForFocus(slice.selected ?? false)}
                key={slice.key}
                onClick={interactive && onSliceClick ? () => onSliceClick(slice) : undefined}
                onMouseEnter={interactive && onSliceMouseEnter ? () => onSliceMouseEnter(slice) : undefined}
                onMouseLeave={interactive && onSliceMouseLeave ? () => onSliceMouseLeave(slice) : undefined}
                stroke="none"
                strokeWidth={0}
              />
            )
          })}
        </Pie>
        {children}
      </PieChart>
    </ResponsiveContainer>
  )
}
