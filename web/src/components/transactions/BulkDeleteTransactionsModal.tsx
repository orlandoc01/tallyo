import { Modal, ModalActions } from '../common/Modal'

export function BulkDeleteTransactionsModal({ error, selectedCount, submitting, onClose, onConfirm }: {
  error?: string | null
  selectedCount: number
  submitting?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal label="Delete selected transactions" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-neutral-950">Delete selected transactions?</h2>
          <p className="mt-1 text-sm text-neutral-500">This will delete {selectedCount} selected transactions.</p>
        </div>
        {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
        <ModalActions busy={submitting} busyLabel="Deleting..." cancelDisabled={submitting} disabled={selectedCount === 0 || submitting} onCancel={onClose} onSubmit={onConfirm} submitLabel="Delete" submitType="button" submitVariant="danger" />
      </div>
    </Modal>
  )
}
