import { useId } from 'react'
import { SelectField, TextField } from '../common/FormControls'
import { ToggleSwitch } from '../common/ToggleSwitch'
import type { AssetClassifier } from '../../types/graphql'
import type { AssetSecurityForm } from './assetSecurityForm'
import { AssetTrackingFields } from './AssetTrackingFields'
import { CLASSIFIER_LABELS } from './assetFormOptions'

type AssetInfoDraft = {
  identifier: string
  name: string
  classifier: AssetClassifier
}

export function AssetInfoFields({
  availableClassifiers,
  canEdit,
  classifierLocked,
  lockedClassifierNote,
  draft,
  updateDraft,
}: {
  availableClassifiers: AssetClassifier[]
  canEdit: boolean
  classifierLocked: boolean
  lockedClassifierNote?: string
  draft: AssetInfoDraft
  updateDraft: (draft: Partial<AssetInfoDraft>) => void
}) {
  return (
    <>
      <TextField disabled={!canEdit} label="Identifier (ticker/symbol)" onChange={(identifier) => updateDraft({ identifier })} type="text" value={draft.identifier} />
      <TextField disabled={!canEdit} label="Name" onChange={(name) => updateDraft({ name })} type="text" value={draft.name} />

      {classifierLocked ? (
        <label className="block">
          <span className="text-xs text-text-muted">Asset Class</span>
          <p className="mt-1 text-[13px] text-text-3">
            {CLASSIFIER_LABELS[draft.classifier]}{lockedClassifierNote ? ` (${lockedClassifierNote})` : ''}
          </p>
        </label>
      ) : (
        <SelectField
          disabled={!canEdit}
          label="Asset Class"
          onChange={(classifier) => updateDraft({ classifier })}
          options={availableClassifiers.map((classifier) => ({ label: CLASSIFIER_LABELS[classifier], value: classifier }))}
          value={draft.classifier}
        />
      )}
    </>
  )
}

export function AssetSecurityFields({ form }: { form: AssetSecurityForm }) {
  const { canEdit, draft, updateDraft } = form
  const descriptionId = useId()
  const fieldsId = useId()

  return (
    <>
      <div className="rounded-md border border-border bg-surface-2 p-3">
        <div className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-text-1">Custom Tracking</span>
            <span className="block text-xs text-text-muted" id={descriptionId}>
              Price this asset from a different ticker via Yahoo Finance and use it for Portfolio classification of public securities.
            </span>
          </span>
          <ToggleSwitch
            aria-controls={fieldsId}
            aria-describedby={descriptionId}
            checked={draft.customTracking}
            disabled={!canEdit}
            label="Custom Tracking"
            onChange={form.setCustomTracking}
          />
        </div>
        {draft.customTracking ? (
          <div className="mt-3" id={fieldsId}>
            <AssetTrackingFields form={form} />
          </div>
        ) : null}
      </div>
      <div className="rounded-md border border-border bg-surface-2 p-3">
        <div className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-text-1">Force Price</span>
            <span className="block text-xs text-text-muted">Override pricing with a fixed USD unit price.</span>
          </span>
          <ToggleSwitch checked={draft.forcePrice} disabled={!canEdit} label="Override pricing with fixed price" onChange={(forcePrice) => updateDraft({ forcePrice })} />
        </div>
        {draft.forcePrice ? (
          <TextField className="mt-3 max-w-40" disabled={!canEdit} label="USD price per unit" min="0" onChange={(forcedUsdPrice) => updateDraft({ forcedUsdPrice })} step="0.01" type="number" value={draft.forcedUsdPrice} />
        ) : null}
      </div>
    </>
  )
}
