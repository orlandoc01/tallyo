import { useState, type KeyboardEvent } from 'react'
import { useMutation } from 'urql'
import { CREATE_OWNER_MUTATION } from '../../graphql/mutations'
import type { Owner } from '../../types/graphql'

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
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [, createOwner] = useMutation<{ createOwner: Owner }, { input: { name: string } }>(CREATE_OWNER_MUTATION)

  function handleSelectChange(val: string) {
    if (val === '__create__') {
      setCreating(true)
      setNewName('')
      setCreateError(null)
    } else {
      onChange(val)
    }
  }

  async function handleCreate() {
    const trimmed = newName.trim()
    if (!trimmed) return

    setIsSubmitting(true)
    setCreateError(null)

    const result = await createOwner({ input: { name: trimmed } })

    setIsSubmitting(false)

    if (result.error) {
      setCreateError(result.error.message)
      return
    }

    const created = result.data?.createOwner
    if (created) {
      onOwnerCreated(created)
      onChange(created.id)
    }

    setCreating(false)
    setNewName('')
  }

  function handleCancel() {
    setCreating(false)
    setNewName('')
    setCreateError(null)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleCreate()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  if (creating) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            aria-label="Owner name"
            autoFocus
            className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            disabled={isSubmitting}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Owner name"
            type="text"
            value={newName}
          />
          <button
            className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmitting || !newName.trim()}
            onClick={() => void handleCreate()}
            type="button"
          >
            {isSubmitting ? 'Adding…' : 'Add'}
          </button>
          <button
            className="rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            disabled={isSubmitting}
            onClick={handleCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
        {createError ? <p className="text-xs text-red-600">{createError}</p> : null}
      </div>
    )
  }

  return (
    <select
      className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
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
