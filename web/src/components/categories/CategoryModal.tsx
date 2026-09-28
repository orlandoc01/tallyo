import { useState, type FormEvent } from 'react'
import { Button } from '../common/Button'
import { FormError, SelectField, TextField } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { ModalTitleRow } from '../common/ModalHeader'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { Category, CategoryGroup } from '../../types/graphql'
import { CategoryPlaidCodes } from './CategoryPlaidCodes'
import { CategorySheet } from './CategorySheet'
import { useCategoryForm } from './useCategoryForm'

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
  const isMobile = useIsMobile()
  const form = useCategoryForm({ category, defaultGroupId, groups, onDeleted, onSaved })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { canDelete, deleting, draft, error, isEdit, kindLabel, patch, saving } = form

  if (isMobile) return <CategorySheet category={category} form={form} groups={groups} onClose={onClose} />

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void form.save()
  }

  async function handleDelete() {
    if (!(await form.remove())) setConfirmDelete(false)
  }

  return (
    <Modal label={isEdit ? 'Edit category' : 'New category'} onClose={onClose}>
        <ModalTitleRow onClose={onClose} title={isEdit ? 'Edit category' : 'New category'} />

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div className="flex gap-3">
            <TextField className="w-24" controlClassName="text-center text-lg" id="cat-emoji" label="Emoji" maxLength={2} onChange={(emoji) => patch({ emoji })} placeholder="🏷️" required value={draft.emoji} />
            <TextField className="flex-1" id="cat-name" label="Name" onChange={(name) => patch({ name })} placeholder="e.g. Groceries" required value={draft.name} />
          </div>

          <div>
            <SelectField id="cat-group" label="Group" onChange={(groupId) => patch({ groupId })} options={groups.map((g) => ({ label: `${g.emoji} ${g.name}`, value: g.id }))} value={draft.groupId} />
            <p className="mt-1 text-xs text-text-faint">Kind: {kindLabel}</p>
          </div>

          {category ? <CategoryPlaidCodes category={category} emoji={draft.emoji} groupId={draft.groupId} groups={groups} name={draft.name} onError={form.setError} /> : null}

          {error ? <FormError>{error}</FormError> : null}

          <div className="flex items-center justify-between gap-2">
            {isEdit ? (
              confirmDelete ? (
                <div className="flex-1 space-y-2 rounded-md bg-negative/10 p-3">
                  <p className="text-[13px] text-negative">
                    This will permanently delete this category. Any auto-categorization rules for this category will also be deleted.
                  </p>
                  <div className="flex gap-2">
                    <Button disabled={deleting} onClick={() => { void handleDelete() }} size="sm" type="button" variant="danger-solid">
                      {deleting ? 'Deleting…' : 'Confirm delete'}
                    </Button>
                    <Button onClick={() => setConfirmDelete(false)} size="sm" type="button" variant="secondary">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button disabled={!canDelete} onClick={() => setConfirmDelete(true)} title={canDelete ? undefined : 'Cannot delete the uncategorized category'} type="button" variant="danger">
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
