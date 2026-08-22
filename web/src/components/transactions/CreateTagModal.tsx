import { useState } from 'react'
import { useMutation } from 'urql'
import { FormError, TextField } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { useSaveAction } from '../../hooks/useSaveAction'
import { CREATE_TAG_MUTATION, UPDATE_TAG_MUTATION } from '../../graphql/mutations'
import type { Tag } from '../../types/graphql'

const colors = ['#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#D946EF', '#EC4899', '#A16207']

export function CreateTagModal({ onClose, onSaved, tag }: { onClose: () => void; onSaved: (tag: Tag) => void; tag?: Tag | null }) {
  const [name, setName] = useState(tag?.name ?? '')
  const [color, setColor] = useState(tag?.color ?? colors[8])
  const { error, saving, save: saveModal } = useSaveAction()
  const [, createTag] = useMutation(CREATE_TAG_MUTATION)
  const [, updateTag] = useMutation(UPDATE_TAG_MUTATION)

  async function handleSave() {
    if (!name.trim()) return
    let saved: Tag | undefined
    await saveModal(async () => {
      const result = tag
        ? await updateTag({ input: { id: tag.id, name: name.trim(), color } })
        : await createTag({ input: { name: name.trim(), color } })
      saved = result.data?.createTag?.tag ?? result.data?.updateTag?.tag
      if (!result.error && !saved) throw new Error('Unable to save tag')
      return result
    }, () => { if (saved) onSaved(saved) })
  }

  return (
    <Modal dismissOnBackdrop={false} label={tag ? 'Edit tag' : 'Create tag'} onClose={onClose}>
        <h3 className="text-lg font-bold">{tag ? 'Edit tag' : 'Create tag'}</h3>
        {error ? <FormError className="mt-3">{error}</FormError> : null}
        <TextField autoFocus className="mt-4" label="Name" onChange={setName} value={name} />
        <div className="mt-4 grid grid-cols-7 gap-2">
          {colors.map((option) => (
            <button key={option} type="button" aria-label={`Color ${option}`} className="h-8 rounded-full border-2" style={{ backgroundColor: option, borderColor: color === option ? '#111827' : 'transparent' }} onClick={() => setColor(option)} />
          ))}
        </div>
        <ModalActions busy={saving} className="mt-5 gap-2" disabled={saving || !name.trim()} onCancel={onClose} onSubmit={handleSave} submitType="button" />
    </Modal>
  )
}
