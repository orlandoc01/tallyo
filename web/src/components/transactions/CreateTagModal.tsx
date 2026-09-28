import clsx from 'clsx'
import { useState } from 'react'
import { useMutation } from 'urql'
import { FormError, TextField } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { Modal, ModalActions } from '../common/Modal'
import { SheetAccordionRow, SheetField } from '../common/SheetRows'
import { useSheetSections } from '../common/useSheetSections'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useSaveAction } from '../../hooks/useSaveAction'
import { CREATE_TAG_MUTATION, UPDATE_TAG_MUTATION } from '../../graphql/mutations'
import type { Tag } from '../../types/graphql'

const colors = ['#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#D946EF', '#EC4899', '#A16207']

type Section = 'name' | 'color'

function ColorGrid({ onChange, value }: { onChange: (color: string) => void; value: string }) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {colors.map((option) => (
        <button key={option} type="button" aria-label={`Color ${option}`} className={clsx('h-8 rounded-full border-2', value === option ? 'border-text-1' : 'border-transparent')} style={{ backgroundColor: option }} onClick={() => onChange(option)} />
      ))}
    </div>
  )
}

interface TagFormProps {
  color: string
  error: string | null
  isEdit: boolean
  name: string
  onClose: () => void
  onSubmit: () => void
  saving: boolean
  setColor: (color: string) => void
  setName: (name: string) => void
}

function TagSheet({ color, error, isEdit, name, onClose, onSubmit, saving, setColor, setName }: TagFormProps) {
  const { open, toggle } = useSheetSections<Section>()
  const footer = <MobileFilterFooter primaryDisabled={saving || !name.trim()} primaryLabel={saving ? 'Saving…' : 'Save'} onPrimary={onSubmit} />
  return (
    <MobileSheet bodyClassName="pb-2" footer={footer} hideClose labelledBy="tag-sheet-title" maxHeight="84%" onClose={onClose} title={isEdit ? 'Edit tag' : 'Create tag'}>
      {error ? <FormError className="mb-3">{error}</FormError> : null}
      <SheetField expanded={open === 'name'} label="Name" onChange={setName} onToggle={toggle('name')} placeholder="Tag name" value={name} />
      <SheetAccordionRow expanded={open === 'color'} label="Color" onToggle={toggle('color')} summary={<span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} />}>
        <ColorGrid onChange={setColor} value={color} />
      </SheetAccordionRow>
    </MobileSheet>
  )
}

export function CreateTagModal({ onClose, onSaved, tag }: { onClose: () => void; onSaved: (tag: Tag) => void; tag?: Tag | null }) {
  const isMobile = useIsMobile()
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

  if (isMobile) {
    return <TagSheet color={color} error={error} isEdit={!!tag} name={name} onClose={onClose} onSubmit={() => { void handleSave() }} saving={saving} setColor={setColor} setName={setName} />
  }

  return (
    <Modal dismissOnBackdrop={false} label={tag ? 'Edit tag' : 'Create tag'} onClose={onClose}>
        <h3 className="text-lg font-bold">{tag ? 'Edit tag' : 'Create tag'}</h3>
        {error ? <FormError className="mt-3">{error}</FormError> : null}
        <TextField autoFocus className="mt-4" label="Name" onChange={setName} value={name} />
        <div className="mt-4"><ColorGrid onChange={setColor} value={color} /></div>
        <ModalActions busy={saving} className="mt-5 gap-2" disabled={saving || !name.trim()} onCancel={onClose} onSubmit={handleSave} submitType="button" />
    </Modal>
  )
}
