import { PageToolbarSegmentedControl } from '../common/PageToolbar'

type AssetBreakdownView = 'ASSETS' | 'LIABILITIES'

const views: Array<{ value: AssetBreakdownView; label: string }> = [
  { value: 'ASSETS', label: 'Assets' },
  { value: 'LIABILITIES', label: 'Liabilities' },
]

export function AssetBreakdownViewToggle({ view, onViewChange }: { view: AssetBreakdownView; onViewChange?: (view: AssetBreakdownView) => void }) {
  if (!onViewChange) return null

  return (
    <PageToolbarSegmentedControl ariaLabel="Asset breakdown view" onChange={onViewChange} options={views} size="sm" value={view} />
  )
}
