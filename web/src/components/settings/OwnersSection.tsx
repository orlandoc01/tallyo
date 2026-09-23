import { useState } from 'react'
import { useMutation } from 'urql'
import { Trash2 } from 'lucide-react'
import { CREATE_OWNER_MUTATION, DELETE_OWNER_MUTATION } from '../../graphql/mutations'
import { useOwners } from '../../hooks/useEntityQueries'
import type { Owner } from '../../types/graphql'
import { Button } from '../common/Button'
import { TextField } from '../common/FormControls'

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
    return <p className="mt-2 text-[13px] text-text-muted">Loading owners…</p>
  }

  if (error) {
    return <p className="mt-2 text-[13px] text-negative">Failed to load owners.</p>
  }

  return (
    <div className="mt-2 max-w-[360px]">
      {owners.length === 0 ? (
        <p className="text-[13px] text-text-muted">No owners yet.</p>
      ) : (
        <ul>
          {owners.map((owner) => (
            <li className="border-t border-border" key={owner.id}>
              <div className="flex h-10 items-center justify-between gap-3">
                <span className="truncate text-sm font-medium text-text-1">{owner.name}</span>
                {canWriteOwners ? (
                  <button
                    aria-label={`Delete ${owner.name}`}
                    className="rounded-md p-1 text-text-muted transition hover:bg-negative/10 hover:text-negative"
                    onClick={() => void handleDelete(owner)}
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                  </button>
                ) : null}
              </div>
              {deleteErrors[owner.id] ? (
                <p className="pb-2 text-xs text-negative">{deleteErrors[owner.id]}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWriteOwners ? <div className="border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <TextField
            className="min-w-0 flex-1"
            disabled={isAdding}
            hideLabel
            label="New owner name"
            onChange={setNewName}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAdd() } }}
            placeholder="New owner name"
            value={newName}
          />
          <Button disabled={isAdding || !newName.trim()} onClick={() => void handleAdd()} type="button">
            {isAdding ? 'Adding…' : 'Add'}
          </Button>
        </div>
        {addError ? <p className="mt-2 text-xs text-negative">{addError}</p> : null}
      </div> : null}
    </div>
  )
}
