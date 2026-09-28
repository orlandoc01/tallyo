import { FormError, FormWarning } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { ModalTitleRow } from '../common/ModalHeader'
import { SegmentedNavTabs } from '../common/SegmentedNavTabs'
import { useIsMobile } from '../../hooks/useIsMobile'
import { formatUnitPrice } from '../../utils/currency'
import type { Asset } from '../../types/graphql'
import { AssetAccountsList } from './AssetAccountsList'
import { AssetEditSheet } from './AssetEditSheet'
import { AssetInfoFields, AssetSecurityFields } from './AssetFormFields'
import { AssetMergePicker } from './AssetMergePicker'
import type { AssetEditTab } from './assetEditTabs'
import { CONNECTIVITY_WARNING, useAssetEditForm } from './useAssetEditForm'

export function AssetEditModal({
  asset,
  activeTab = 'info',
  basePath,
  tabSearch = '',
  onClose,
  onUpdate,
}: {
  asset: Asset
  activeTab?: AssetEditTab
  basePath: string
  tabSearch?: string
  onClose: () => void
  onUpdate?: (asset: Asset) => void
}) {
  const isMobile = useIsMobile()
  const form = useAssetEditForm({ asset, onClose, onUpdate, tabSearch })
  const {
    amountsHidden, availableClassifiers, canEdit, canReadAssetAccounts, canSave, classifierLocked, draft, error,
    handleSave, hasConnectivityIssue, hasTrackingTab, isRealEstate, isSecurity, isSaving, updateDraft,
  } = form
  const currentTab = activeTab === 'tracking' && !hasTrackingTab ? 'info' : activeTab

  if (isMobile) {
    return <AssetEditSheet asset={asset} basePath={basePath} currentTab={currentTab} form={form} onClose={onClose} onUpdate={onUpdate} tabSearch={tabSearch} />
  }

  return (
    <Modal onClose={onClose} label={`Edit ${asset.name ?? asset.identifier}`} scrollable>
      <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void handleSave() }}>
        <ModalTitleRow onClose={onClose} title="Edit Asset" />

        <div className="space-y-1 text-[13px] text-text-3">
          <p>
            <span className="text-text-muted">Type:</span> {asset.assetType}
            &middot; <span className="text-text-faint">{asset.classifier}</span>
          </p>
          {asset.currentPrice != null ? (
            <p>
              <span className="text-text-muted">Price:</span> {formatUnitPrice(asset.currentPrice)}
            </p>
          ) : null}
        </div>

        {hasConnectivityIssue ? <FormWarning>{CONNECTIVITY_WARNING}</FormWarning> : null}

        <SegmentedNavTabs
          ariaLabel="Asset edit sections"
          items={hasTrackingTab
            ? [
              { to: `${basePath}/info${tabSearch}`, children: 'Info' },
              { to: `${basePath}/tracking${tabSearch}`, children: 'Tracking' },
            ]
            : [{ to: `${basePath}/info${tabSearch}`, children: 'Info' }]}
        />

        {currentTab === 'info' ? (
          <div className="space-y-4">
            {isRealEstate ? (
              <p className="text-[13px] text-text-muted">
                Real estate assets are managed through the Accounts page.
              </p>
            ) : (
              <AssetInfoFields availableClassifiers={availableClassifiers} canEdit={canEdit} classifierLocked={classifierLocked} draft={draft} updateDraft={updateDraft} />
            )}
            {canReadAssetAccounts ? <AssetAccountsList amountsHidden={amountsHidden} assetId={asset.id} /> : null}
          </div>
        ) : null}

        {currentTab === 'tracking' && hasTrackingTab ? (
          <div className="space-y-4">
            {isSecurity ? (
              <AssetSecurityFields form={form} />
            ) : null}
            <AssetMergePicker asset={asset} canEdit={canEdit} onClose={onClose} onUpdate={onUpdate} />
          </div>
        ) : null}

        {error ? <FormError>{error}</FormError> : null}

        {canEdit && !isRealEstate ? <ModalActions busy={isSaving} busyLabel="Saving…" disabled={!canSave} onCancel={onClose} /> : null}
      </form>
    </Modal>
  )
}
