import { useState } from 'react'
import type { Owner } from '../../types/graphql'
import { OwnerCreateForm } from './OwnerCreateForm'

export function OwnerSelect({
  owners,
  value,
  onChange,
  canCreate,
  onOwnerCreated,
}: {
  owners: Owner[]
  value: string
  onChange: (id: string) => void
  canCreate: boolean
  onOwnerCreated: (owner: Owner) => void
}) {
  const [creating, setCreating] = useState(false)

  function handleSelectChange(val: string) {
    if (val === '__create__') setCreating(true)
    else onChange(val)
  }

  if (creating) {
    return (
      <OwnerCreateForm
        onCancel={() => setCreating(false)}
        onCreated={(owner) => {
          onOwnerCreated(owner)
          onChange(owner.id)
          setCreating(false)
        }}
      />
    )
  }

  return (
    <select
      className="mt-1.5 h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-[13px] text-text-1 outline-none focus:border-brand-600 lg:h-8 dark:bg-bg"
      onChange={(e) => handleSelectChange(e.target.value)}
      value={value}
    >
      <option value="">Choose owner</option>
      {owners.map((owner) => (
        <option key={owner.id} value={owner.id}>
          {owner.name}
        </option>
      ))}
      {canCreate ? <option value="__create__">+ Create new owner…</option> : null}
    </select>
  )
}
