import { useId, useState } from 'react'
import type { Category, CategoryGroup } from '../../types/graphql'
import { FormError } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetDangerAction } from '../common/SheetDangerAction'
import { SheetAccordionRow, SheetField, SheetPickList, SheetStaticRow } from '../common/SheetRows'
import { SheetTabButtons, SheetTabPanel } from '../common/SheetTabs'
import { useSheetSections } from '../common/useSheetSections'
import { CategoryPlaidCodes } from './CategoryPlaidCodes'
import type { useCategoryForm } from './useCategoryForm'

type Section = 'emoji' | 'name' | 'group'
type Tab = 'info' | 'plaid'

const TAB_ITEMS: Array<{ id: Tab; children: string }> = [{ id: 'info', children: 'Info' }, { id: 'plaid', children: 'Plaid' }]

function groupLabel(group: CategoryGroup | undefined) {
  return group ? `${group.emoji} ${group.name}` : 'Choose group'
}

export function CategorySheet({ category, form, groups, onClose }: {
  category: Category | null
  form: ReturnType<typeof useCategoryForm>
  groups: CategoryGroup[]
  onClose: () => void
}) {
  const { open, pickOne, toggle } = useSheetSections<Section>()
  const tabsId = useId()
  const [tab, setTab] = useState<Tab>('info')
  const { canDelete, draft, patch } = form
  const footer = <MobileFilterFooter primaryDisabled={!form.canSave} primaryLabel={form.saving ? 'Saving…' : 'Save'} onPrimary={() => { void form.save() }} />

  const infoRows = (
    <>
      <SheetField expanded={open === 'emoji'} label="Emoji" maxLength={2} onChange={(emoji) => patch({ emoji })} onToggle={toggle('emoji')} placeholder="🏷️" value={draft.emoji} />
      <SheetField expanded={open === 'name'} label="Name" onChange={(name) => patch({ name })} onToggle={toggle('name')} placeholder="e.g. Groceries" value={draft.name} />
      <SheetAccordionRow expanded={open === 'group'} label="Group" onToggle={toggle('group')} summary={groupLabel(groups.find((g) => g.id === draft.groupId))}>
        <SheetPickList options={groups.map((g) => ({ id: g.id, ariaLabel: g.name, label: groupLabel(g) }))} selectedIds={[draft.groupId]} onChange={pickOne((groupId) => patch({ groupId }))} />
      </SheetAccordionRow>
      <SheetStaticRow label="Kind" value={form.kindLabel} />
    </>
  )

  return (
    <MobileSheet bodyClassName="pb-2" footer={footer} hideClose labelledBy="category-sheet-title" maxHeight="84%" onClose={onClose} title={category ? 'Edit category' : 'New category'}>
      {category ? <SheetTabButtons ariaLabel="Category sections" idPrefix={tabsId} items={TAB_ITEMS} onChange={setTab} value={tab} /> : null}
      {form.error ? <FormError className="my-3">{form.error}</FormError> : null}
      {!category ? infoRows : tab === 'info' ? (
        <SheetTabPanel idPrefix={tabsId} tabId="info">
          {infoRows}
          <SheetDangerAction
            busy={form.deleting}
            busyLabel="Deleting…"
            disabled={!canDelete}
            hint="Auto-categorization rules for this category are deleted too."
            label="Delete category"
            onSelect={() => { void form.remove() }}
            title={canDelete ? undefined : 'Cannot delete the uncategorized category'}
          />
        </SheetTabPanel>
      ) : (
        <SheetTabPanel idPrefix={tabsId} tabId="plaid"><div className="pt-3"><CategoryPlaidCodes category={category} emoji={draft.emoji} groupId={draft.groupId} groups={groups} name={draft.name} onError={form.setError} /></div></SheetTabPanel>
      )}
    </MobileSheet>
  )
}
