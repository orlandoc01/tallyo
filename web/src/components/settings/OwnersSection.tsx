import { useState } from 'react'
import { useMutation } from 'urql'
import { Trash2 } from 'lucide-react'
import { CREATE_OWNER_MUTATION, DELETE_OWNER_MUTATION } from '../../graphql/mutations'
import { useOwners } from '../../hooks/useEntityQueries'
import type { Owner } from '../../types/graphql'
import { Button } from '../common/Button'

export function OwnersSection({ canWriteOwners }: { canWriteOwners: boolean }) {
  const { owners, fetching, error, refetch } = useOwners()
  const [, createOwner] = useMutation<{ createOwner: Owner }, { input: { name: string } }>(CREATE_OWNER_MUTATION)
  const [, deleteOwner] = useMutation<{ deleteOwner: boolean }, { id: string }>(DELETE_OWNER_MUTATION)

  const [newName, setNewName] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({})

  async function handleAdd() {
    const trimmed = newName.trim()
    if (!trimmed) return

    setIsAdding(true)
    setAddError(null)

    const result = await createOwner({ input: { name: trimmed } })

    setIsAdding(false)

    if (result.error) {
      setAddError(result.error.message)
      return
    }

    setNewName('')
    refetch({ requestPolicy: 'network-only' })
  }

  async function handleDelete(owner: Owner) {
    setDeleteErrors((prev) => {
      const next = { ...prev }
      delete next[owner.id]
      return next
    })

    const result = await deleteOwner({ id: owner.id })

    if (result.error) {
      setDeleteErrors((prev) => ({ ...prev, [owner.id]: result.error!.message }))
      return
    }

    refetch({ requestPolicy: 'network-only' })
  }

  if (fetching) {
    return <p className="text-sm text-neutral-500">Loading owners…</p>
  }

  if (error) {
    return <p className="text-sm text-red-600">Failed to load owners.</p>
  }

  return (
    <div className="max-w-md space-y-4">
      {owners.length === 0 ? (
        <p className="text-sm text-neutral-500">No owners yet.</p>
      ) : (
        <ul className="space-y-2">
          {owners.map((owner) => (
            <li key={owner.id}>
              <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-2">
                <span className="text-sm font-medium text-neutral-900">{owner.name}</span>
                {canWriteOwners ? (
                  <button
                    aria-label={`Delete ${owner.name}`}
                    className="rounded-xl p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => void handleDelete(owner)}
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              {deleteErrors[owner.id] ? (
                <p className="mt-1 px-1 text-xs text-red-600">{deleteErrors[owner.id]}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWriteOwners ? <div className="space-y-2">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            disabled={isAdding}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAdd() } }}
            placeholder="New owner name"
            type="text"
            value={newName}
          />
          <Button disabled={isAdding || !newName.trim()} onClick={() => void handleAdd()} type="button">
            {isAdding ? 'Adding…' : 'Add'}
          </Button>
        </div>
        {addError ? <p className="text-xs text-red-600">{addError}</p> : null}
      </div> : null}
    </div>
  )
}
