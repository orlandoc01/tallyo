import type { AssetClassifier, AssetType } from '../../types/graphql'
import { FormError } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetAccordionRow, SheetField, SheetPickList, SheetStaticRow } from '../common/SheetRows'
import { useSheetSections } from '../common/useSheetSections'
import { AssetTrackingSheetRows } from './AssetEditSheet'
import { ASSET_TYPE_LABELS, CLASSIFIER_LABELS } from './assetFormOptions'
import { CREATE_ASSET_TYPES, type useAssetCreateForm } from './useAssetCreateForm'

type Section = 'type' | 'identifier' | 'name' | 'classifier' | 'cusip' | 'isin'

export function AssetCreateSheet({ form, onClose }: { form: ReturnType<typeof useAssetCreateForm>; onClose: () => void }) {
  const { open, pickOne, toggle } = useSheetSections<Section>()
  const { canEdit, draft, updateDraft } = form
  const classifierLabel = CLASSIFIER_LABELS[draft.classifier]
  let classifierRow
  if (form.classifierLocked) classifierRow = <SheetStaticRow label="Asset class" value={`${classifierLabel} (always Cash & Equivalents for currency assets)`} />
  else if (!canEdit) classifierRow = <SheetStaticRow label="Asset class" value={classifierLabel} />
  else {
    classifierRow = (
      <SheetAccordionRow expanded={open === 'classifier'} label="Asset class" onToggle={toggle('classifier')} summary={classifierLabel}>
        <SheetPickList<AssetClassifier> options={form.availableClassifiers.map((classifier) => ({ id: classifier, label: CLASSIFIER_LABELS[classifier] }))} selectedIds={[draft.classifier]} onChange={pickOne((classifier) => updateDraft({ classifier }))} />
      </SheetAccordionRow>
    )
  }
  const footer = canEdit
    ? <MobileFilterFooter primaryDisabled={!form.canSave} primaryLabel={form.isSaving ? 'Creating…' : 'Create'} onPrimary={() => { void form.save() }} />
    : <MobileFilterFooter primaryLabel="Done" onPrimary={onClose} />

  return (
    <MobileSheet bodyClassName="pb-2" footer={footer} hideClose labelledBy="asset-create-sheet-title" maxHeight="84%" onClose={onClose} title="New asset">
      {form.error ? <FormError className="mb-3">{form.error}</FormError> : null}
      {canEdit ? (
        <SheetAccordionRow expanded={open === 'type'} label="Asset type" onToggle={toggle('type')} summary={ASSET_TYPE_LABELS[draft.assetType]}>
          <SheetPickList<AssetType> options={CREATE_ASSET_TYPES.map((type) => ({ id: type, label: ASSET_TYPE_LABELS[type] }))} selectedIds={[draft.assetType]} onChange={pickOne(form.handleAssetTypeChange)} />
        </SheetAccordionRow>
      ) : <SheetStaticRow label="Asset type" value={ASSET_TYPE_LABELS[draft.assetType]} />}
      <SheetField disabled={!canEdit} expanded={open === 'identifier'} label="Identifier" onChange={(identifier) => updateDraft({ identifier })} onToggle={toggle('identifier')} placeholder="Ticker or symbol" value={draft.identifier} />
      <SheetField disabled={!canEdit} expanded={open === 'name'} label="Name" onChange={(name) => updateDraft({ name })} onToggle={toggle('name')} placeholder="Asset name" value={draft.name} />
      {classifierRow}
      {form.isSecurity ? (
        <>
          <AssetTrackingSheetRows form={form} />
          <SheetField disabled={!canEdit} expanded={open === 'cusip'} label="CUSIP" onChange={(cusip) => updateDraft({ cusip })} onToggle={toggle('cusip')} placeholder="CUSIP" value={draft.cusip} />
          <SheetField disabled={!canEdit} expanded={open === 'isin'} label="ISIN" onChange={(isin) => updateDraft({ isin })} onToggle={toggle('isin')} placeholder="ISIN" value={draft.isin} />
        </>
      ) : null}
    </MobileSheet>
  )
}
