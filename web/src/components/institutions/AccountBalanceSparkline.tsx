import { DeltaText } from '../common/DeltaText'
import { sparklineChange, sparklineLabels, type SparklinePoint } from './accountValuation'

const WIDTH = 100
const HEIGHT = 110
const PAD = 4

function coordinates(points: SparklinePoint[]) {
  const values = points.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = points.length > 1 ? WIDTH / (points.length - 1) : 0
  return points.map((point, index) => ({ x: index * step, y: PAD + ((max - point.value) / span) * (HEIGHT - PAD * 2) }))
}

export function AccountBalanceSparkline({ points }: { points: SparklinePoint[] }) {
  const delta = sparklineChange(points)
  const coords = coordinates(points)
  const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
  const area = coords.length ? `${line} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z` : ''

  return (
    <div className="pb-1 pt-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-3">Balance · past 12 months</span>
        {delta ? <DeltaText changePct={delta.changePct} changeUSD={delta.changeUSD} className="font-medium" size="sm" /> : null}
      </div>
      {coords.length > 1 ? (
        <>
          <svg aria-label="Balance history" className="mt-2 h-[110px] w-full overflow-visible" preserveAspectRatio="none" role="img" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
            <path className="fill-brand-600/[0.15]" d={area} />
            <path className="stroke-accent" d={line} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <line className="stroke-border-emph" strokeWidth={1} vectorEffect="non-scaling-stroke" x1={0} x2={WIDTH} y1={HEIGHT} y2={HEIGHT} />
          </svg>
          <div className="mt-1 flex justify-between text-[11px] text-text-3">
            {sparklineLabels(points).map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-text-muted">Not enough history for a chart yet.</p>
      )}
    </div>
  )
}
