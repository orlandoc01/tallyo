import type { CategoryKind } from '../../types/graphql'
import { FormError } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetAccordionRow, SheetField, SheetPickList, SheetStaticRow } from '../common/SheetRows'
import { Tag } from '../common/Tag'
import { useSheetSections } from '../common/useSheetSections'
import { CATEGORY_KIND_TINT } from './categoryKindTint'
import { KIND_OPTIONS, type useGroupForm } from './useGroupForm'

type Section = 'emoji' | 'name' | 'kind'

export function GroupSheet({ form, onClose }: { form: ReturnType<typeof useGroupForm>; onClose: () => void }) {
  const { open, pickOne, toggle } = useSheetSections<Section>()
  const { draft, patch } = form
  const kindLabel = KIND_OPTIONS.find((option) => option.value === draft.kind)?.label ?? draft.kind
  const footer = <MobileFilterFooter primaryDisabled={!form.canSave} primaryLabel={form.saving ? 'Saving…' : 'Save'} onPrimary={() => { void form.save() }} />

  return (
    <MobileSheet bodyClassName="pb-2" footer={footer} hideClose labelledBy="group-sheet-title" maxHeight="84%" onClose={onClose} title={form.isEdit ? 'Edit group' : 'New group'}>
      {form.error ? <FormError className="mb-3">{form.error}</FormError> : null}
      <SheetField expanded={open === 'emoji'} label="Emoji" maxLength={2} onChange={(emoji) => patch({ emoji })} onToggle={toggle('emoji')} placeholder="🗂️" value={draft.emoji} />
      <SheetField expanded={open === 'name'} label="Name" onChange={(name) => patch({ name })} onToggle={toggle('name')} placeholder="e.g. Food & Dining" value={draft.name} />
      {form.isEdit ? <SheetStaticRow label="Kind" value={<Tag size="badge" tint={CATEGORY_KIND_TINT[draft.kind]}>{draft.kind}</Tag>} /> : (
        <SheetAccordionRow expanded={open === 'kind'} label="Kind" onToggle={toggle('kind')} summary={kindLabel}>
          <SheetPickList<CategoryKind> options={KIND_OPTIONS.map((option) => ({ id: option.value, label: option.label }))} selectedIds={[draft.kind]} onChange={pickOne((kind) => patch({ kind }))} />
        </SheetAccordionRow>
      )}
    </MobileSheet>
  )
}
