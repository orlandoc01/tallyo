import { useState } from 'react'

// Single-open accordion state for a sheet body: `pickOne` applies a single-select pick and collapses the row.
export function useSheetSections<Section extends string>() {
  const [open, setOpen] = useState<Section | null>(null)
  const toggle = (section: Section) => () => setOpen((current) => current === section ? null : section)
  const pickOne = <T extends string>(apply: (id: T) => void) => ([id]: T[]) => { apply(id); setOpen(null) }
  return { open, toggle, pickOne }
}
