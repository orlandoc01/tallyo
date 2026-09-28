import type { FormEvent } from 'react'
import { FormError, SelectField, TextField } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { ModalTitleRow } from '../common/ModalHeader'
import { Tag } from '../common/Tag'
import { CATEGORY_KIND_TINT } from './categoryKindTint'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { CategoryGroup } from '../../types/graphql'
import { GroupSheet } from './GroupSheet'
import { KIND_OPTIONS, useGroupForm } from './useGroupForm'

export function GroupModal({
  group,
  onClose,
  onSaved,
}: {
  group: CategoryGroup | null
  onClose: () => void
  onSaved: () => void
}) {
  const isMobile = useIsMobile()
  const form = useGroupForm({ group, onSaved })
  const { draft, error, isEdit, patch, saving } = form

  if (isMobile) return <GroupSheet form={form} onClose={onClose} />

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void form.save()
  }

  return (
    <Modal label={isEdit ? 'Edit group' : 'New group'} onClose={onClose}>
        <ModalTitleRow onClose={onClose} title={isEdit ? 'Edit group' : 'New group'} />

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div className="flex gap-3">
            <TextField className="w-24" controlClassName="text-center text-lg" id="group-emoji" label="Emoji" maxLength={2} onChange={(emoji) => patch({ emoji })} placeholder="🗂️" required value={draft.emoji} />
            <TextField className="flex-1" id="group-name" label="Name" onChange={(name) => patch({ name })} placeholder="e.g. Food & Dining" required value={draft.name} />
          </div>

          {isEdit ? (
            <div>
              <span className="text-xs text-text-muted">Kind</span>
              <Tag className="ml-2" size="badge" tint={CATEGORY_KIND_TINT[draft.kind]}>{draft.kind}</Tag>
              <p className="mt-1 text-xs text-text-faint">Kind cannot be changed after creation.</p>
            </div>
          ) : (
            <SelectField id="group-kind" label="Kind" onChange={(kind) => patch({ kind })} options={KIND_OPTIONS} value={draft.kind} />
          )}

          {error ? <FormError>{error}</FormError> : null}

          <ModalActions busy={saving} busyLabel="Saving…" className="gap-2" disabled={saving} onCancel={onClose} />
        </form>
    </Modal>
  )
}
