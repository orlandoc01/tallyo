import { useState, type FormEvent } from 'react'
import { useMutation } from 'urql'
import { UPDATE_CONNECTION_MUTATION } from '../../graphql/mutations'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { PlaidItem, UpdateConnectionInput, UpdateConnectionPayload } from '../../types/graphql'
import { formatScheduleTime } from '../../utils/dates'
import { FormError, TextField } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { Modal, ModalActions, ModalFooter } from '../common/Modal'
import { ModalHeader } from '../common/ModalHeader'
import { SheetMeta } from '../common/SheetHero'
import { SheetField } from '../common/SheetRows'
import { useSheetSections } from '../common/useSheetSections'
import { useSaveAction } from '../../hooks/useSaveAction'

type Section = 'sync' | 'recurring'

interface SyncSettingsFormProps {
  canSave: boolean
  error: string | null
  item: PlaidItem
  onClose: () => void
  onSubmit: () => void
  recurringSyncCron: string
  saving: boolean
  setRecurringSyncCron: (value: string) => void
  setSyncCron: (value: string) => void
  syncCron: string
}

function SyncSettingsSheet({ canSave, error, item, onClose, onSubmit, recurringSyncCron, saving, setRecurringSyncCron, setSyncCron, syncCron }: SyncSettingsFormProps) {
  const { open, toggle } = useSheetSections<Section>()
  const footer = <MobileFilterFooter primaryDisabled={!canSave} primaryLabel={saving ? 'Saving…' : 'Save settings'} onPrimary={onSubmit} />
  return (
    <MobileSheet bodyClassName="pb-2" footer={footer} hideClose labelledBy="sync-settings-sheet-title" maxHeight="84%" onClose={onClose} title="Sync settings">
      <SheetMeta rows={[{ k: 'Next transaction sync', v: formatScheduleTime(item.nextSyncAt) }, { k: 'Next recurring sync', v: formatScheduleTime(item.nextRecurringSyncAt) }]} />
      {error ? <FormError className="mb-3">{error}</FormError> : null}
      <SheetField expanded={open === 'sync'} label="Transaction sync cron" mono onChange={setSyncCron} onToggle={toggle('sync')} placeholder="0 6,18 * * *" value={syncCron} />
      <SheetField expanded={open === 'recurring'} label="Recurring charge sync cron" mono onChange={setRecurringSyncCron} onToggle={toggle('recurring')} placeholder="0 12 * * 0" value={recurringSyncCron} />
      <p className="py-3 text-xs text-text-3">Use standard 5-field cron expressions. Schedules must be at least 1 hour apart.</p>
    </MobileSheet>
  )
}

export function SyncSettingsModal({
  item,
  name,
  connectionId,
  onClose,
  onUpdated,
}: {
  item: PlaidItem
  name: string
  connectionId: string
  onClose: () => void
  onUpdated: (item: PlaidItem) => void
}) {
  const isMobile = useIsMobile()
  const [syncCron, setSyncCron] = useState(item.syncCron)
  const [recurringSyncCron, setRecurringSyncCron] = useState(item.recurringSyncCron)
  const { error, saving, save } = useSaveAction()
  const [, updateSettings] = useMutation<
    { updateConnection: UpdateConnectionPayload },
    { input: UpdateConnectionInput }
  >(UPDATE_CONNECTION_MUTATION)
  const isDirty = syncCron !== item.syncCron || recurringSyncCron !== item.recurringSyncCron
  const canSave = !saving && isDirty && syncCron.trim() !== '' && recurringSyncCron.trim() !== ''

  function submit() {
    if (!isDirty) return
    void save(
      () => updateSettings({ input: { connectionId, syncCron, recurringSyncCron } }),
      (result) => {
        const provider = result.data?.updateConnection.connection?.provider
        if (provider?.__typename === 'PlaidItem') onUpdated(provider)
      },
    )
  }

  if (isMobile) {
    return <SyncSettingsSheet canSave={canSave} error={error} item={item} onClose={onClose} onSubmit={submit} recurringSyncCron={recurringSyncCron} saving={saving} setRecurringSyncCron={setRecurringSyncCron} setSyncCron={setSyncCron} syncCron={syncCron} />
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  return (
    <Modal label={`Sync settings for ${name}`} onClose={onClose} size="lg">
        <ModalHeader closeLabel={`Close sync settings for ${name}`} onClose={onClose} subtitle={`Cron schedules for ${name}.`} title="Sync settings" />

        {error ? <FormError className="mt-5 font-semibold">{error}</FormError> : null}

        <dl className="mt-4 grid gap-2 rounded-2xl bg-surface-2 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-text-3">Next transaction sync</dt>
            <dd className="font-medium text-text-1">{formatScheduleTime(item.nextSyncAt)}</dd>
          </div>
          <div>
            <dt className="text-text-3">Next recurring sync</dt>
            <dd className="font-medium text-text-1">{formatScheduleTime(item.nextRecurringSyncAt)}</dd>
          </div>
        </dl>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <p className="text-xs text-text-3"><span aria-hidden="true" className="text-negative">*</span> Required</p>
          <TextField aria-invalid={!syncCron.trim()} controlClassName="font-mono" label="Transaction sync cron" labelSuffix={<span aria-hidden="true" className="text-negative"> *</span>} onChange={setSyncCron} placeholder="0 6,18 * * *" required type="text" value={syncCron} />
          <TextField aria-invalid={!recurringSyncCron.trim()} controlClassName="font-mono" label="Recurring charge sync cron" labelSuffix={<span aria-hidden="true" className="text-negative"> *</span>} onChange={setRecurringSyncCron} placeholder="0 12 * * 0" required type="text" value={recurringSyncCron} />

          <p className="text-xs text-text-3">Use standard 5-field cron expressions. Schedules must be at least 1 hour apart.</p>

          <ModalFooter>
            <ModalActions busy={saving} disabled={!canSave} onCancel={onClose} submitLabel="Save settings" />
          </ModalFooter>
        </form>
    </Modal>
  )
}
