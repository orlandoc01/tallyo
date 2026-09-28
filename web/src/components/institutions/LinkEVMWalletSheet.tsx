import { FormError } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetField } from '../common/SheetRows'
import { useSheetSections } from '../common/useSheetSections'
import { ChainsRow } from './AccountInfoSheetRows'
import { OwnerLoadStatus } from './OwnerSelectField'
import { OwnerPickRow } from './OwnerPickRow'
import type { useLinkEVMWalletForm } from './useLinkEVMWalletForm'

type Section = 'address' | 'label' | 'owner' | 'chains'

export function LinkEVMWalletSheet({ form, onClose }: { form: ReturnType<typeof useLinkEVMWalletForm>; onClose: () => void }) {
  const { open, toggle } = useSheetSections<Section>()
  const footer = <MobileFilterFooter primaryDisabled={!form.canSubmit} primaryLabel={form.submitting ? 'Linking…' : 'Link wallet'} onPrimary={() => { void form.submit() }} />

  return (
    <MobileSheet bodyClassName="pb-2" dismissible={!form.submitting} footer={footer} hideClose labelledBy="link-evm-wallet-sheet-title" maxHeight="84%" onClose={onClose} title="Link crypto wallet">
      <OwnerLoadStatus error={form.ownersError} fetching={form.ownersFetching} />
      {form.submitError ? <FormError className="mb-3">{form.submitError}</FormError> : null}
      <SheetField expanded={open === 'address'} label="Wallet address" mono onChange={form.setAddress} onToggle={toggle('address')} placeholder="0x…" value={form.address} />
      <SheetField expanded={open === 'label'} label="Label" onChange={form.setLabel} onToggle={toggle('label')} placeholder="e.g. Main wallet" value={form.label} />
      <OwnerPickRow canCreate={form.canCreateOwner} expanded={open === 'owner'} onChange={form.setSelectedOwner} onOwnerCreated={form.handleOwnerCreated} onToggle={toggle('owner')} owners={form.owners} value={form.selectedOwner} />
      <ChainsRow chainIds={form.chainIds} changed={false} expanded={open === 'chains'} onChange={form.setChainIds} onToggle={toggle('chains')} />
    </MobileSheet>
  )
}
