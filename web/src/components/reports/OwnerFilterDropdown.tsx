import { useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useOwners } from '../../hooks/useEntityQueries'
import type { Owner } from '../../types/graphql'
import { CollapsibleFilterSection } from '../common/CollapsibleFilterSection'
import { filterSummary } from '../common/filterSummary'
import { FilterCheckboxList } from '../common/FilterCheckboxList'

function OwnerSelector({
  owners,
  selectedOwners,
  onChange,
}: {
  owners: Owner[]
  selectedOwners: string[]
  onChange: (ownerIds: string[]) => void
}) {
  return (
    <FilterCheckboxList options={ownerOptions(owners)} selectedIds={selectedOwners} onChange={onChange} />
  )
}

// Collapsible "Owner" filter section shared by the Reports and Cash Flow
// filter panels. Fetches the owner list itself and renders nothing when
// owners are hidden or there is only one owner to filter by.
export function OwnerFilterSection({
  selectedOwners,
  onChange,
}: {
  selectedOwners: string[]
  onChange: (ownerIds: string[]) => void
}) {
  const { hideOwners } = useAuth()
  const { owners } = useOwners()
  const [expanded, setExpanded] = useState(false)

  if (hideOwners || owners.length < 2) return null

  return (
    <CollapsibleFilterSection
      active={selectedOwners.length > 0}
      expanded={expanded}
      label="Owner"
      summary={filterSummary(selectedOwners.length)}
      onToggle={() => setExpanded((open) => !open)}
    >
      <OwnerSelector onChange={onChange} owners={owners} selectedOwners={selectedOwners} />
    </CollapsibleFilterSection>
  )
}

function ownerOptions(owners: Owner[]) {
  return owners.map((owner) => ({ id: owner.id, label: owner.name, ariaLabel: owner.name }))
}
