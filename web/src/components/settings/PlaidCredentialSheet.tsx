import type { PlaidEnvironment } from '../../types/graphql'
import { FormError } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetDangerAction } from '../common/SheetDangerAction'
import { SheetAccordionRow, SheetField, SheetPickList } from '../common/SheetRows'
import { useSheetSections } from '../common/useSheetSections'
import { ENVIRONMENT_OPTIONS, type PlaidCredentialFormMode, type usePlaidCredentialForm } from './usePlaidCredentialForm'

type Section = 'clientId' | 'secret' | 'label' | 'environment'

export function PlaidCredentialSheet({ form, mode, onClose }: { form: ReturnType<typeof usePlaidCredentialForm>; mode: PlaidCredentialFormMode; onClose: () => void }) {
  const { open, pickOne, toggle } = useSheetSections<Section>()
  const isEdit = mode === 'edit'
  const environmentLabel = ENVIRONMENT_OPTIONS.find((option) => option.value === form.environment)?.label ?? form.environment
  const footer = <MobileFilterFooter primaryDisabled={form.saving || !form.clientId.trim() || !form.secret.trim()} primaryLabel={form.saving ? 'Saving…' : 'Save'} onPrimary={() => { void form.submit() }} />

  return (
    <MobileSheet bodyClassName="pb-2" footer={footer} hideClose labelledBy="plaid-credential-sheet-title" maxHeight="84%" onClose={onClose} title={isEdit ? 'Rotate credential' : 'Store credentials'}>
      <p className="pb-2 text-[13px] text-text-3">{isEdit ? 'Update the secret or environment. The client ID cannot be changed.' : 'Save a Plaid client ID and secret.'}</p>
      {form.error ? <FormError className="mb-3">{form.error}</FormError> : null}
      <SheetField disabled={isEdit} expanded={open === 'clientId'} label="Client ID" mono onChange={form.setClientId} onToggle={toggle('clientId')} placeholder="Client ID" value={form.clientId} />
      <SheetField expanded={open === 'secret'} label="Client secret" mono onChange={form.setSecret} onToggle={toggle('secret')} placeholder="Client secret" type="password" value={form.secret} />
      {isEdit ? null : <SheetField expanded={open === 'label'} label="Label" onChange={form.setLabel} onToggle={toggle('label')} placeholder="Primary" value={form.label} />}
      <SheetAccordionRow expanded={open === 'environment'} label="Environment" onToggle={toggle('environment')} summary={environmentLabel}>
        <SheetPickList<PlaidEnvironment> options={ENVIRONMENT_OPTIONS.map((option) => ({ id: option.value, label: option.label }))} selectedIds={[form.environment]} onChange={pickOne<PlaidEnvironment>(form.setEnvironment)} />
      </SheetAccordionRow>
      {isEdit ? <SheetDangerAction busy={form.deleting} busyLabel="Deleting…" disabled={form.saving} label="Delete credential" onSelect={() => { void form.remove() }} /> : null}
    </MobileSheet>
  )
}
