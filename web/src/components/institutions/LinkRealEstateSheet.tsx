import { FormError } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetAccordionRow, SheetField } from '../common/SheetRows'
import { useSheetSections } from '../common/useSheetSections'
import { AddressFields } from './AddressFields'
import { OwnerLoadStatus } from './OwnerSelectField'
import { OwnerPickRow } from './OwnerPickRow'
import { joinAddress } from './propertyAddress'
import type { useLinkRealEstateForm } from './useLinkRealEstateForm'

type Section = 'address' | 'label' | 'valuation' | 'owner'

export function LinkRealEstateSheet({ form, onClose }: { form: ReturnType<typeof useLinkRealEstateForm>; onClose: () => void }) {
  const { open, toggle } = useSheetSections<Section>()
  const footer = <MobileFilterFooter primaryDisabled={form.submitting} primaryLabel={form.submitting ? 'Linking…' : 'Link home'} onPrimary={() => { void form.submit() }} />

  return (
    <MobileSheet bodyClassName="pb-2" footer={footer} hideClose labelledBy="link-real-estate-sheet-title" maxHeight="84%" onClose={onClose} title="Link home">
      <OwnerLoadStatus error={form.ownersError} fetching={form.ownersFetching} />
      {form.submitError ? <FormError className="mb-3">{form.submitError}</FormError> : null}
      <SheetAccordionRow expanded={open === 'address'} label="Address" onToggle={toggle('address')} summary={joinAddress(form.addressDraft) || 'Add address'}>
        <AddressFields address={form.addressDraft} onChange={form.handleAddressChange} />
      </SheetAccordionRow>
      <SheetField expanded={open === 'label'} label="Label" onChange={form.setLabel} onToggle={toggle('label')} placeholder="e.g. Primary home" value={form.label} />
      <SheetField expanded={open === 'valuation'} inputMode="decimal" label="Manual valuation USD" onChange={form.setValuationUSD} onToggle={toggle('valuation')} placeholder="850000" type="number" value={form.valuationUSD} />
      <OwnerPickRow canCreate={form.canCreateOwner} expanded={open === 'owner'} onChange={form.setSelectedOwner} onOwnerCreated={form.handleOwnerCreated} onToggle={toggle('owner')} owners={form.owners} value={form.selectedOwner} />
    </MobileSheet>
  )
}
