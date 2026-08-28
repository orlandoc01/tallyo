import { useState } from 'react'
import type { AnalysisSlice, Asset } from '../../types/graphql'
import { analysisSliceColor } from './analysisSliceColor'
import { AnalysisSliceRow } from './AnalysisSliceRow'

export function AnalysisSliceList({ slices, amountsHidden = false, selectedLabel, onEditAsset, onSelectedLabelChange }: { slices: AnalysisSlice[]; amountsHidden?: boolean; selectedLabel?: string | null; onEditAsset?: (asset: Asset) => void; onSelectedLabelChange?: (label: string | null) => void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (slices.length === 0) {
    return <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">No portfolio slices to show yet.</div>
  }

  return (
    <section className="min-w-0 space-y-3" aria-label="Analysis slices">
      {slices.map((slice, index) => (
        <AnalysisSliceRow
          active={selectedLabel === slice.label}
          color={analysisSliceColor(slice.label, index)}
          expanded={Boolean(expanded[slice.label])}
          key={slice.label}
          amountsHidden={amountsHidden}
          onFocusChange={onSelectedLabelChange ?? (() => {})}
          onEditAsset={onEditAsset}
          slice={slice}
          onToggle={() => {
            const nextExpanded = !expanded[slice.label]
            setExpanded((current) => ({ ...current, [slice.label]: nextExpanded }))
            onSelectedLabelChange?.(nextExpanded ? slice.label : null)
          }}
        />
      ))}
    </section>
  )
}
