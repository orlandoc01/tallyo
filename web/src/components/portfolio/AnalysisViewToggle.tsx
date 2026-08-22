import type { AnalysisView } from '../../types/graphql'
import { PageToolbarSegmentedControl } from '../common/PageToolbar'

const views: Array<{ value: AnalysisView; label: string }> = [
  { value: 'COMPOSITION', label: 'Composition' },
  { value: 'MORNINGSTAR_CATEGORY', label: 'Category' },
  { value: 'MORNINGSTAR_GROUP', label: 'Group' },
  { value: 'SECTORS', label: 'Sectors' },
]

export function AnalysisViewToggle({ value, onChange }: { value: AnalysisView; onChange: (value: AnalysisView) => void }) {
  return (
    <>
      {/* Mobile: native dropdown */}
      <select
        aria-label="Analysis view"
        className="lg:hidden w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 outline-none focus:border-brand-500"
        onChange={(e) => onChange(e.target.value as AnalysisView)}
        value={value}
      >
        {views.map((view) => (
          <option key={view.value} value={view.value}>{view.label}</option>
        ))}
      </select>
      {/* Desktop: pill buttons */}
      <div className="hidden lg:block">
        <PageToolbarSegmentedControl ariaLabel="Analysis view" options={views} value={value} onChange={onChange} />
      </div>
    </>
  )
}
