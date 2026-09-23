import clsx from 'clsx'

export interface DonutSlice {
  key: string
  label: string
  value: number
  color: string
}

const OUTER_RADIUS = 100
const DEFAULT_INNER_RADIUS = 72
const GAP_DEGREES = 0.6

export function Donut({ ariaLabel, className, hoveredKey, innerRadius = DEFAULT_INNER_RADIUS, selectedKey, slices, onHover, onSelect }: {
  ariaLabel: string
  className?: string
  hoveredKey?: string | null
  innerRadius?: number
  selectedKey?: string | null
  slices: DonutSlice[]
  onHover?: (key: string | null) => void
  onSelect?: (key: string) => void
}) {
  const total = slices.reduce((sum, slice) => sum + Math.max(slice.value, 0), 0)
  const highlighted = hoveredKey ?? selectedKey ?? null
  const gap = slices.length > 1 ? GAP_DEGREES : 0
  const arcs = slices.reduce<Array<DonutSlice & { start: number; end: number }>>((acc, slice) => {
    const start = acc.length ? acc[acc.length - 1].end : -90
    const sweep = total > 0 ? (Math.max(slice.value, 0) / total) * 360 : 0
    return [...acc, { ...slice, start, end: start + sweep }]
  }, [])

  return (
    <div className={clsx('relative', className)}>
      <svg aria-label={ariaLabel} className="block h-auto w-full" role="img" viewBox="-110 -110 220 220">
        {arcs.map((arc) => {
          const dimmed = highlighted !== null && highlighted !== arc.key
          const interactive = Boolean(onSelect || onHover)
          const d = annulusSectorPath(arc.start + gap / 2, arc.end - gap / 2, innerRadius)
          if (!d) return null
          return (
            <path
              className={clsx('transition-[opacity,transform] duration-150', interactive && 'cursor-pointer')}
              d={d}
              fill={arc.color}
              key={arc.key}
              onClick={onSelect ? () => onSelect(arc.key) : undefined}
              onPointerEnter={onHover ? (event) => { if (event.pointerType === 'mouse') onHover(arc.key) } : undefined}
              onPointerLeave={onHover ? (event) => { if (event.pointerType === 'mouse') onHover(null) } : undefined}
              style={{ opacity: dimmed ? 0.35 : 1, transform: hoveredKey === arc.key ? 'scale(1.04)' : undefined, transformOrigin: '0 0', transformBox: 'view-box' }}
            >
              <title>{arc.label}</title>
            </path>
          )
        })}
      </svg>
    </div>
  )
}

function polar(radius: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180
  return `${(radius * Math.cos(radians)).toFixed(3)} ${(radius * Math.sin(radians)).toFixed(3)}`
}

function annulusSectorPath(start: number, end: number, inner: number): string | null {
  if (end - start >= 359.999) {
    const mid = start + 180
    return `M ${polar(OUTER_RADIUS, start)} A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 1 1 ${polar(OUTER_RADIUS, mid)} A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 1 1 ${polar(OUTER_RADIUS, start)} Z M ${polar(inner, start)} A ${inner} ${inner} 0 1 0 ${polar(inner, mid)} A ${inner} ${inner} 0 1 0 ${polar(inner, start)} Z`
  }
  if (end <= start) return null
  const large = end - start > 180 ? 1 : 0
  return `M ${polar(OUTER_RADIUS, start)} A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 ${large} 1 ${polar(OUTER_RADIUS, end)} L ${polar(inner, end)} A ${inner} ${inner} 0 ${large} 0 ${polar(inner, start)} Z`
}
