import { useState, type FormEvent } from 'react'
import { useMutation } from 'urql'
import { UPDATE_CONNECTION_MUTATION } from '../../graphql/mutations'
import type { PlaidItem, UpdateConnectionInput, UpdateConnectionPayload } from '../../types/graphql'
import { FormError, TextField } from '../common/FormControls'
import { Modal, ModalActions, ModalFooter } from '../common/Modal'
import { ModalHeader } from '../common/ModalHeader'
import { useSaveAction } from '../../hooks/useSaveAction'

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
  const [syncCron, setSyncCron] = useState(item.syncCron)
  const [recurringSyncCron, setRecurringSyncCron] = useState(item.recurringSyncCron)
  const { error, saving, save } = useSaveAction()
  const [, updateSettings] = useMutation<
    { updateConnection: UpdateConnectionPayload },
    { input: UpdateConnectionInput }
  >(UPDATE_CONNECTION_MUTATION)
  const isDirty = syncCron !== item.syncCron || recurringSyncCron !== item.recurringSyncCron

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!isDirty) return

    await save(
      () => updateSettings({ input: { connectionId, syncCron, recurringSyncCron } }),
      (result) => {
        const provider = result.data?.updateConnection.connection?.provider
        if (provider?.__typename === 'PlaidItem') onUpdated(provider)
      },
    )
  }

  return (
    <Modal label={`Sync settings for ${name}`} onClose={onClose} size="lg">
        <ModalHeader closeLabel={`Close sync settings for ${name}`} onClose={onClose} subtitle={`Cron schedules for ${name}.`} title="Sync settings" />

        {error ? <FormError className="mt-5 font-semibold">{error}</FormError> : null}

        <dl className="mt-4 grid gap-2 rounded-2xl bg-neutral-50 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-neutral-500">Next transaction sync</dt>
            <dd className="font-medium text-neutral-900">{formatScheduleTime(item.nextSyncAt)}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Next recurring sync</dt>
            <dd className="font-medium text-neutral-900">{formatScheduleTime(item.nextRecurringSyncAt)}</dd>
          </div>
        </dl>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <p className="text-xs text-neutral-500"><span aria-hidden="true" className="text-red-500">*</span> Required</p>
          <TextField aria-invalid={!syncCron.trim()} controlClassName="font-mono" label="Transaction sync cron" labelSuffix={<span aria-hidden="true" className="text-red-500"> *</span>} onChange={setSyncCron} placeholder="0 6,18 * * *" required type="text" value={syncCron} />
          <TextField aria-invalid={!recurringSyncCron.trim()} controlClassName="font-mono" label="Recurring charge sync cron" labelSuffix={<span aria-hidden="true" className="text-red-500"> *</span>} onChange={setRecurringSyncCron} placeholder="0 12 * * 0" required type="text" value={recurringSyncCron} />

          <p className="text-xs text-neutral-500">Use standard 5-field cron expressions. Schedules must be at least 1 hour apart.</p>

          <ModalFooter>
            <ModalActions busy={saving} disabled={saving || !isDirty || !syncCron.trim() || !recurringSyncCron.trim()} onCancel={onClose} submitLabel="Save settings" />
          </ModalFooter>
        </form>
    </Modal>
  )
}

function formatScheduleTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not scheduled'
}
