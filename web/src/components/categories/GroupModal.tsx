import { useState, type FormEvent } from 'react'
import { useMutation } from 'urql'
import { FormError, SelectField, TextField } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { ModalTitleRow } from '../common/ModalHeader'
import { Tag } from '../common/Tag'
import { CATEGORY_KIND_TINT } from './categoryKindTint'
import { useSaveAction } from '../../hooks/useSaveAction'
import type { CategoryGroup, CategoryKind } from '../../types/graphql'
import { CREATE_CATEGORY_GROUP_MUTATION, UPDATE_CATEGORY_GROUP_MUTATION } from '../../graphql/mutations'

const KIND_OPTIONS: { value: CategoryKind; label: string }[] = [
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'INCOME', label: 'Income' },
  { value: 'TRANSFER', label: 'Transfer' },
]

export function GroupModal({
  group,
  onClose,
  onSaved,
}: {
  group: CategoryGroup | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = group !== null
  const [emoji, setEmoji] = useState(group?.emoji ?? '')
  const [name, setName] = useState(group?.name ?? '')
  const [kind, setKind] = useState<CategoryKind>(group?.kind ?? 'EXPENSE')
  const { error, saving, save } = useSaveAction()

  const [, createGroup] = useMutation(CREATE_CATEGORY_GROUP_MUTATION)
  const [, updateGroup] = useMutation(UPDATE_CATEGORY_GROUP_MUTATION)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    await save(
      () => isEdit
        ? updateGroup({ input: { id: group.id, name, emoji } })
        : createGroup({ input: { name, emoji, kind } }),
      onSaved,
    )
  }

  return (
    <Modal label={isEdit ? 'Edit group' : 'New group'} onClose={onClose}>
        <ModalTitleRow onClose={onClose} title={isEdit ? 'Edit group' : 'New group'} />

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div className="flex gap-3">
            <TextField className="w-24" controlClassName="text-center text-lg" id="group-emoji" label="Emoji" maxLength={2} onChange={setEmoji} placeholder="🗂️" required value={emoji} />
            <TextField className="flex-1" id="group-name" label="Name" onChange={setName} placeholder="e.g. Food & Dining" required value={name} />
          </div>

          {isEdit ? (
            <div>
              <span className="text-xs text-text-muted">Kind</span>
              <Tag className="ml-2" size="badge" tint={CATEGORY_KIND_TINT[group.kind]}>{group.kind}</Tag>
              <p className="mt-1 text-xs text-text-faint">Kind cannot be changed after creation.</p>
            </div>
          ) : (
            <SelectField id="group-kind" label="Kind" onChange={setKind} options={KIND_OPTIONS} value={kind} />
          )}

          {error ? <FormError>{error}</FormError> : null}

          <ModalActions busy={saving} busyLabel="Saving…" className="gap-2" disabled={saving} onCancel={onClose} />
        </form>
    </Modal>
  )
}
