import { useState, type KeyboardEvent } from 'react'
import { useMutation } from 'urql'
import { CREATE_OWNER_MUTATION } from '../../graphql/mutations'
import { useSaveAction } from '../../hooks/useSaveAction'
import type { Owner } from '../../types/graphql'
import { Button } from '../common/Button'
import { TextField, type FieldVariant } from '../common/FormControls'

export function OwnerCreateForm({ onCancel, onCreated, variant = 'default' }: { onCancel: () => void; onCreated: (owner: Owner) => void; variant?: FieldVariant }) {
  const [newName, setNewName] = useState('')
  const { error, save, saving } = useSaveAction()
  const [, createOwner] = useMutation<{ createOwner: Owner }, { input: { name: string } }>(CREATE_OWNER_MUTATION)

  function handleCreate() {
    const trimmed = newName.trim()
    if (!trimmed) return
    void save(() => createOwner({ input: { name: trimmed } }), (result) => { if (result.data?.createOwner) onCreated(result.data.createOwner) })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleCreate()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <TextField autoFocus className="flex-1" disabled={saving} hideLabel label="Owner name" onChange={setNewName} onKeyDown={handleKeyDown} placeholder="Owner name" value={newName} variant={variant} />
        <Button disabled={saving || !newName.trim()} onClick={handleCreate} size="sm" type="button">{saving ? 'Adding…' : 'Add'}</Button>
        <Button disabled={saving} onClick={onCancel} size="sm" type="button" variant="secondary">Cancel</Button>
      </div>
      {error ? <p className="text-xs text-negative">{error}</p> : null}
    </div>
  )
}
