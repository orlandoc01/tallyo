import { useEffect, useState } from 'react'
import type { AssetClassifier } from '../../types/graphql'

// Selection and expansion state shared by the wealth breakdown views (donut
// legend, detailed table): selecting a classifier or liability category
// toggles it and auto-expands its group.
export function useBreakdownSelection({
  onSelectClassifier,
  onSelectLiabilityCategory,
  selectedClassifier,
  selectedLiabilityCategory,
}: {
  onSelectClassifier?: (classifier: AssetClassifier | null) => void
  onSelectLiabilityCategory?: (category: string | null) => void
  selectedClassifier?: AssetClassifier | null
  selectedLiabilityCategory?: string | null
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const selectedKeys = [selectedClassifier, selectedLiabilityCategory].filter((key): key is string => !!key)
    if (selectedKeys.length) setOpen((current) => ({ ...current, ...Object.fromEntries(selectedKeys.map((key) => [key, true])) }))
  }, [selectedClassifier, selectedLiabilityCategory])

  function toggleOpen(key: string) {
    setOpen((current) => ({ ...current, [key]: !current[key] }))
  }

  function handleClassifierClick(classifier: AssetClassifier) {
    onSelectClassifier?.(selectedClassifier === classifier ? null : classifier)
  }

  function handleLiabilityClick(category: string) {
    onSelectLiabilityCategory?.(selectedLiabilityCategory === category ? null : category)
  }

  return { handleClassifierClick, handleLiabilityClick, open, toggleOpen }
}
