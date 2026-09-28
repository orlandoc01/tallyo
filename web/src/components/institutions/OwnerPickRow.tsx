import { useState } from 'react'
import type { Owner } from '../../types/graphql'
import { OwnerDot } from '../common/OwnerDot'
import { SheetAccordionRow, SheetPickList } from '../common/SheetRows'
import { OwnerCreateForm } from './OwnerCreateForm'

export function OwnerPickRow({ canCreate, changed = false, expanded, onChange, onOwnerCreated, onToggle, owners, placeholder = 'Choose owner', value }: {
  canCreate: boolean
  changed?: boolean
  expanded: boolean
  onChange: (ownerId: string) => void
  onOwnerCreated?: (owner: Owner) => void
  onToggle: () => void
  owners: Owner[]
  placeholder?: string
  value: string
}) {
  const [creating, setCreating] = useState(false)
  const summary = owners.find((owner) => owner.id === value)?.name ?? placeholder

  function select(ownerId: string) {
    onChange(ownerId)
    onToggle()
  }

  return (
    <SheetAccordionRow changed={changed} expanded={expanded} label="Owner" onToggle={onToggle} summary={summary}>
      {creating ? (
        <OwnerCreateForm
          variant="sheet"
          onCancel={() => setCreating(false)}
          onCreated={(owner) => {
            onOwnerCreated?.(owner)
            setCreating(false)
            select(owner.id)
          }}
        />
      ) : (
        <>
          <SheetPickList
            options={owners.map((owner) => ({ id: owner.id, ariaLabel: owner.name, label: owner.name, leading: <OwnerDot name={owner.name} /> }))}
            selectedIds={[value]}
            onChange={([ownerId]) => select(ownerId)}
          />
          {canCreate ? <button className="h-9 px-2.5 text-[13px] font-medium text-accent" onClick={() => setCreating(true)} type="button">+ New owner</button> : null}
        </>
      )}
    </SheetAccordionRow>
  )
}
