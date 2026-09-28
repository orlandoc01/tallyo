import type { Asset, AssetClassifier } from '../../types/graphql'
import { formatUnitPrice } from '../../utils/currency'
import { FormError, FormWarning, TextField } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetHero } from '../common/SheetHero'
import { SheetAccordionRow, SheetField, SheetPickList, SheetStaticRow, SheetToggleRow } from '../common/SheetRows'
import { useSheetSections } from '../common/useSheetSections'
import { SheetTabs } from '../common/SheetTabs'
import { TickerChip } from '../common/Tag'
import { AssetAccountsList } from './AssetAccountsList'
import type { AssetEditTab } from './assetEditTabs'
import { ASSET_TYPE_LABELS, CLASSIFIER_LABELS } from './assetFormOptions'
import type { AssetSecurityForm } from './assetSecurityForm'
import { AssetMergePicker } from './AssetMergePicker'
import { AssetTrackingFields } from './AssetTrackingFields'
import { CONNECTIVITY_WARNING, type useAssetEditForm } from './useAssetEditForm'

type AssetEditForm = ReturnType<typeof useAssetEditForm>
type Section = 'identifier' | 'name' | 'classifier'

function AssetInfoSheetRows({ asset, form }: { asset: Asset; form: AssetEditForm }) {
  const { open, pickOne, toggle } = useSheetSections<Section>()
  const { draft, updateDraft } = form

  if (form.isRealEstate) {
    return <p className="py-3 text-[13px] text-text-muted">Real estate assets are managed through the Accounts page.</p>
  }
  if (!form.canEdit) {
    return (
      <>
        <SheetStaticRow label="Identifier" value={asset.identifier} />
        <SheetStaticRow label="Name" value={asset.name ?? '—'} />
        <SheetStaticRow label="Asset class" value={CLASSIFIER_LABELS[asset.classifier]} />
      </>
    )
  }
  return (
    <>
      <SheetField changed={draft.identifier !== asset.identifier} expanded={open === 'identifier'} label="Identifier" onChange={(identifier) => updateDraft({ identifier })} onToggle={toggle('identifier')} placeholder="Ticker or symbol" value={draft.identifier} />
      <SheetField changed={draft.name !== (asset.name ?? '')} expanded={open === 'name'} label="Name" onChange={(name) => updateDraft({ name })} onToggle={toggle('name')} placeholder="Asset name" value={draft.name} />
      {form.classifierLocked ? <SheetStaticRow label="Asset class" value={CLASSIFIER_LABELS[draft.classifier]} /> : (
        <SheetAccordionRow changed={draft.classifier !== asset.classifier} expanded={open === 'classifier'} label="Asset class" onToggle={toggle('classifier')} summary={CLASSIFIER_LABELS[draft.classifier]}>
          <SheetPickList<AssetClassifier>
            options={form.availableClassifiers.map((classifier) => ({ id: classifier, label: CLASSIFIER_LABELS[classifier] }))}
            selectedIds={[draft.classifier]}
            onChange={pickOne((classifier) => updateDraft({ classifier }))}
          />
        </SheetAccordionRow>
      )}
    </>
  )
}

export function AssetTrackingSheetRows({ form }: { form: AssetSecurityForm }) {
  const { canEdit, draft, updateDraft } = form
  return (
    <>
      <SheetToggleRow
        checked={draft.customTracking}
        description="Price this asset from a different Yahoo Finance ticker."
        disabled={!canEdit}
        label="Custom tracking"
        onChange={form.setCustomTracking}
      />
      {draft.customTracking ? (
        <div className="pb-3">
          <AssetTrackingFields form={form} variant="sheet" />
        </div>
      ) : null}
      <SheetToggleRow checked={draft.forcePrice} description="Override pricing with a fixed USD unit price." disabled={!canEdit} label="Force price" onChange={(forcePrice) => updateDraft({ forcePrice })} />
      {draft.forcePrice ? (
        <div className="pb-3">
          <TextField disabled={!canEdit} label="USD price per unit" min="0" onChange={(forcedUsdPrice) => updateDraft({ forcedUsdPrice })} step="0.01" type="number" value={draft.forcedUsdPrice} variant="sheet" />
        </div>
      ) : null}
    </>
  )
}

export function AssetEditSheet({ asset, basePath, currentTab, form, onClose, onUpdate, tabSearch }: {
  asset: Asset
  basePath: string
  currentTab: AssetEditTab
  form: AssetEditForm
  onClose: () => void
  onUpdate?: (asset: Asset) => void
  tabSearch: string
}) {
  const name = asset.name ?? asset.identifier
  const footer = form.canEdit && !form.isRealEstate
    ? <MobileFilterFooter primaryDisabled={!form.canSave} primaryLabel={form.isSaving ? 'Saving…' : 'Save'} onPrimary={() => { void form.handleSave() }} />
    : <MobileFilterFooter primaryLabel="Done" onPrimary={onClose} />

  return (
    <MobileSheet bodyClassName="pb-2" footer={footer} hideClose labelledBy="asset-edit-title" maxHeight="84%" onClose={onClose} title="Asset">
      <div aria-label={`Edit ${name}`} role="region">
        <SheetHero
          avatar={<TickerChip size="md">{form.isRealEstate ? 'RE' : asset.identifier}</TickerChip>}
          sub={`${ASSET_TYPE_LABELS[asset.assetType]} · ${CLASSIFIER_LABELS[asset.classifier]}`}
          title={name}
          value={asset.currentPrice != null ? formatUnitPrice(asset.currentPrice) : undefined}
        />
        {form.hasConnectivityIssue ? <FormWarning className="mb-3">{CONNECTIVITY_WARNING}</FormWarning> : null}
        <SheetTabs
          ariaLabel="Asset edit sections"
          items={form.hasTrackingTab
            ? [{ to: `${basePath}/info${tabSearch}`, children: 'Info' }, { to: `${basePath}/tracking${tabSearch}`, children: 'Tracking' }]
            : [{ to: `${basePath}/info${tabSearch}`, children: 'Info' }]}
        />
        {form.error ? <FormError className="mt-3">{form.error}</FormError> : null}
        {currentTab === 'info' ? (
          <>
            <AssetInfoSheetRows asset={asset} form={form} />
            {form.canReadAssetAccounts ? <div className="mt-3"><AssetAccountsList amountsHidden={form.amountsHidden} assetId={asset.id} /></div> : null}
          </>
        ) : null}
        {currentTab === 'tracking' && form.hasTrackingTab ? (
          <>
            {form.isSecurity ? <AssetTrackingSheetRows form={form} /> : null}
            <div className="mt-3"><AssetMergePicker asset={asset} canEdit={form.canEdit} onClose={onClose} onUpdate={onUpdate} variant="sheet" /></div>
          </>
        ) : null}
      </div>
    </MobileSheet>
  )
}
