import type { AccountType } from '../../types/graphql'
import { ACCOUNT_TYPES, formatAccountType } from '../../utils/accountSubtypes'
import { FormError } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetAccordionRow, SheetField, SheetPickList, SheetToggleRow } from '../common/SheetRows'
import { useSheetSections } from '../common/useSheetSections'
import { OwnerPickRow } from './OwnerPickRow'
import type { useManualAccountForm } from './useManualAccountForm'

type Section = 'name' | 'owner' | 'type'

export function AddManualAccountSheet({ form, institutionName, onClose }: {
  form: ReturnType<typeof useManualAccountForm>
  institutionName: string
  onClose: () => void
}) {
  const { open, pickOne, toggle } = useSheetSections<Section>()
  const { draft, patch } = form
  const footer = <MobileFilterFooter primaryDisabled={!form.canSave} primaryLabel={form.saving ? 'Creating…' : 'Create account'} onPrimary={() => { void form.save() }} />

  return (
    <MobileSheet bodyClassName="pb-2" footer={footer} hideClose labelledBy="manual-account-sheet-title" maxHeight="84%" onClose={onClose} title="Add manual account">
      <p className="pb-2 text-[13px] text-text-3">Under {institutionName}</p>
      {form.error ? <FormError className="mb-3">{form.error}</FormError> : null}
      {form.noOwnersReadOnly ? <FormError className="mb-3">No owners exist. An admin must create an owner before adding an account.</FormError> : null}
      <SheetField expanded={open === 'name'} label="Account name" onChange={(name) => patch({ name })} onToggle={toggle('name')} placeholder="e.g. Old Amex Gold" value={draft.name} />
      <OwnerPickRow canCreate={form.canCreateOwner} expanded={open === 'owner'} onChange={(ownerId) => patch({ ownerId })} onOwnerCreated={form.handleOwnerCreated} onToggle={toggle('owner')} owners={form.owners} value={form.effectiveOwnerId} />
      <SheetAccordionRow expanded={open === 'type'} label="Type" onToggle={toggle('type')} summary={formatAccountType(draft.type)}>
        <SheetPickList<AccountType> options={ACCOUNT_TYPES.map((type) => ({ id: type, label: formatAccountType(type) }))} selectedIds={[draft.type]} onChange={pickOne((type) => patch({ type }))} />
      </SheetAccordionRow>
      <SheetToggleRow checked={draft.closed} label="Closed" onChange={(closed) => patch({ closed })} />
      <SheetToggleRow checked={draft.hidden} label="Hidden" onChange={(hidden) => patch({ hidden })} />
    </MobileSheet>
  )
}
