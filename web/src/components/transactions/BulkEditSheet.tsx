import type { ReactNode } from 'react'
import type { Category, Tag } from '../../types/graphql'
import { FormError, TextAreaField } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetPickList, SheetToggleRow } from '../common/SheetRows'
import { CategoryPickList } from './CategoryPickList'
import { TagPickList } from './TagPickList'
import type { BulkEditSection, useBulkEditForm } from './useBulkEditForm'

type YesNo = 'yes' | 'no'
const YES_NO_OPTIONS = [{ id: 'yes' as const, label: 'Yes' }, { id: 'no' as const, label: 'No' }]

function YesNoPick({ onChange, value }: { onChange: (value: boolean) => void; value: boolean }) {
  return <SheetPickList<YesNo> options={YES_NO_OPTIONS} selectedIds={[value ? 'yes' : 'no']} onChange={([id]) => onChange(id === 'yes')} />
}

export function BulkEditSheet({ categories, error, form, onClose, onConfirm, selectedCount, submitting, tags }: {
  categories: Category[]
  error?: string | null
  form: ReturnType<typeof useBulkEditForm>
  onClose: () => void
  onConfirm: () => void
  selectedCount: number
  submitting: boolean
  tags: Tag[]
}) {
  const { active, toggle } = form
  const section = (key: BulkEditSection, label: string, control: ReactNode) => (
    <>
      <SheetToggleRow checked={active.has(key)} label={label} onChange={() => toggle(key)} />
      {active.has(key) ? <div className="pb-3">{control}</div> : null}
    </>
  )
  const footer = (
    <MobileFilterFooter
      primaryDisabled={!form.canConfirm || selectedCount === 0 || submitting}
      primaryLabel={submitting ? 'Saving…' : 'Confirm'}
      onPrimary={onConfirm}
    />
  )

  return (
    <MobileSheet bodyClassName="pb-2" dismissible={!submitting} footer={footer} hideClose labelledBy="bulk-edit-sheet-title" maxHeight="84%" onClose={onClose} title="Edit multiple">
      <p className="pb-2 text-[13px] text-text-3">Update {selectedCount} selected transactions.</p>
      {error ? <FormError className="mb-3">{error}</FormError> : null}
      {section('category', 'Set category', <CategoryPickList categories={categories} onChange={([id]) => form.setCategoryId(id)} selectedId={form.categoryId} />)}
      {section('notes', 'Replace notes', <TextAreaField hideLabel label="Notes" onChange={form.setNotes} placeholder="Replace notes" rows={3} value={form.notes} variant="sheet" />)}
      {section('recurring', 'Set recurring', <YesNoPick onChange={form.setIsRecurring} value={form.isRecurring} />)}
      {section('hidden', 'Set hidden', <YesNoPick onChange={form.setIsHidden} value={form.isHidden} />)}
      {section('tags', 'Set tags', <TagPickList onChange={form.setTagIds} selectedIds={form.tagIds} tags={tags} />)}
    </MobileSheet>
  )
}
