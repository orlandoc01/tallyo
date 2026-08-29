import { useState, type FormEvent } from 'react'
import { useMutation } from 'urql'
import { Button } from '../common/Button'
import { SelectField, TextField } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { ModalCloseButton } from '../common/ModalHeader'
import { useSaveAction } from '../../hooks/useSaveAction'
import type { Category, CategoryGroup } from '../../types/graphql'
import { CREATE_CATEGORY_MUTATION, UPDATE_CATEGORY_MUTATION, DELETE_CATEGORY_MUTATION } from '../../graphql/mutations'
import { CategoryPlaidCodes } from './CategoryPlaidCodes'

export function CategoryModal({
  category,
  defaultGroupId,
  groups,
  onClose,
  onSaved,
  onDeleted,
}: {
  category: Category | null
  defaultGroupId?: string
  groups: CategoryGroup[]
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const isEdit = category !== null
  const initialGroupId = category ? groups.find((g) => g.name === category.groupName)?.id ?? groups[0]?.id : (defaultGroupId ?? groups[0]?.id)

  const [emoji, setEmoji] = useState(category?.emoji ?? '')
  const [name, setName] = useState(category?.name ?? '')
  const [groupId, setGroupId] = useState<string>(initialGroupId ?? '')
  const { error, saving, save, setError } = useSaveAction()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [, createCategory] = useMutation(CREATE_CATEGORY_MUTATION)
  const [, updateCategory] = useMutation(UPDATE_CATEGORY_MUTATION)
  const [, deleteCategory] = useMutation(DELETE_CATEGORY_MUTATION)

  const selectedGroup = groups.find((g) => g.id === groupId)
  const kindLabel = selectedGroup?.kind ?? 'EXPENSE'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    await save(
      () => isEdit
        ? updateCategory({ input: { id: category.id, name, emoji, groupId } })
        : createCategory({ input: { name, emoji, groupId } }),
      onSaved,
    )
  }

  async function handleDelete() {
    if (!category) return
    setError(null)
    setDeleting(true)
    try {
      const result = await deleteCategory({ id: category.id })
      if (result.error) throw new Error(result.error.message)
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred')
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal label={isEdit ? 'Edit category' : 'New category'} onClose={onClose}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit category' : 'New category'}</h2>
          <ModalCloseButton onClick={onClose} />
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="flex gap-3">
            <TextField className="w-24" controlClassName="text-center text-lg" id="cat-emoji" label="Emoji" maxLength={2} onChange={setEmoji} placeholder="🏷️" required value={emoji} />
            <TextField className="flex-1" id="cat-name" label="Name" onChange={setName} placeholder="e.g. Groceries" required value={name} />
          </div>

          <div>
            <SelectField id="cat-group" label="Group" onChange={setGroupId} options={groups.map((g) => ({ label: `${g.emoji} ${g.name}`, value: g.id }))} value={groupId} />
            <p className="mt-1 text-xs text-neutral-400">Kind: {kindLabel}</p>
          </div>

          {isEdit ? <CategoryPlaidCodes category={category} emoji={emoji} groupId={groupId} groups={groups} name={name} onError={setError} /> : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex items-center justify-between gap-2">
            {isEdit ? (
              confirmDelete ? (
                <div className="flex-1 space-y-2 rounded-xl bg-red-50 p-3">
                  <p className="text-sm text-red-700">
                    This will permanently delete this category. Any auto-categorization rules for this category will also be deleted.
                  </p>
                  <div className="flex gap-2">
                    <Button disabled={deleting} onClick={handleDelete} size="sm" type="button" variant="danger-solid">
                      {deleting ? 'Deleting…' : 'Confirm delete'}
                    </Button>
                    <Button onClick={() => setConfirmDelete(false)} size="sm" type="button" variant="secondary">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button disabled={category.id === '0'} onClick={() => setConfirmDelete(true)} title={category.id === '0' ? 'Cannot delete the uncategorized category' : undefined} type="button" variant="danger">
                  Delete
                </Button>
              )
            ) : (
              <span />
            )}

            <ModalActions busy={saving} busyLabel="Saving…" className="gap-2" disabled={saving} onCancel={onClose} />
          </div>
        </form>
    </Modal>
  )
}
