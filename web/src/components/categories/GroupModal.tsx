import { useState, type FormEvent } from 'react'
import { useMutation } from 'urql'
import { SelectField, TextField } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { ModalCloseButton } from '../common/ModalHeader'
import { useSaveAction } from '../../hooks/useSaveAction'
import type { CategoryGroup, CategoryKind } from '../../types/graphql'
import { CREATE_CATEGORY_GROUP_MUTATION, UPDATE_CATEGORY_GROUP_MUTATION } from '../../graphql/mutations'

const KIND_OPTIONS: { value: CategoryKind; label: string }[] = [
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'INCOME', label: 'Income' },
  { value: 'TRANSFER', label: 'Transfer' },
]

const KIND_BADGE_CLASSES: Record<CategoryKind, string> = {
  EXPENSE: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  INCOME: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
  TRANSFER: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
}

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
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit group' : 'New group'}</h2>
          <ModalCloseButton onClick={onClose} />
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="flex gap-3">
            <TextField className="w-24" controlClassName="text-center text-lg" id="group-emoji" label="Emoji" maxLength={2} onChange={setEmoji} placeholder="🗂️" required value={emoji} />
            <TextField className="flex-1" id="group-name" label="Name" onChange={setName} placeholder="e.g. Food & Dining" required value={name} />
          </div>

          {isEdit ? (
            <div>
              <span className="text-sm font-medium text-neutral-700">Kind</span>
              <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_BADGE_CLASSES[group.kind]}`}>
                {group.kind}
              </span>
              <p className="mt-1 text-xs text-neutral-400">Kind cannot be changed after creation.</p>
            </div>
          ) : (
            <SelectField id="group-kind" label="Kind" onChange={setKind} options={KIND_OPTIONS} value={kind} />
          )}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <ModalActions busy={saving} busyLabel="Saving…" className="gap-2" disabled={saving} onCancel={onClose} />
        </form>
    </Modal>
  )
}
