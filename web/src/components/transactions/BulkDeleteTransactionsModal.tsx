import { useIsMobile } from '../../hooks/useIsMobile'
import { FormError } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { Modal, ModalActions } from '../common/Modal'

interface BulkDeleteProps {
  error?: string | null
  selectedCount: number
  submitting?: boolean
  onClose: () => void
  onConfirm: () => void
}

function BulkDeleteSheet({ error, selectedCount, submitting = false, onClose, onConfirm }: BulkDeleteProps) {
  const footer = (
    <MobileFilterFooter
      onSecondary={onClose}
      primaryDisabled={selectedCount === 0 || submitting}
      primaryLabel={submitting ? 'Deleting…' : 'Delete'}
      primaryVariant="danger-solid"
      secondaryLabel="Cancel"
      onPrimary={onConfirm}
    />
  )
  return (
    <MobileSheet bodyClassName="pb-2" dismissible={!submitting} footer={footer} hideClose labelledBy="bulk-delete-sheet-title" onClose={onClose} title="Delete transactions">
      <p className="py-3 text-sm text-text-2">This will delete {selectedCount} selected transactions.</p>
      {error ? <FormError className="mb-3">{error}</FormError> : null}
    </MobileSheet>
  )
}

export function BulkDeleteTransactionsModal(props: BulkDeleteProps) {
  const isMobile = useIsMobile()
  if (isMobile) return <BulkDeleteSheet {...props} />

  const { error, selectedCount, submitting, onClose, onConfirm } = props
  return (
    <Modal label="Delete selected transactions" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-text-1">Delete selected transactions?</h2>
          <p className="mt-1 text-sm text-text-3">This will delete {selectedCount} selected transactions.</p>
        </div>
        {error ? <p className="text-sm font-medium text-negative">{error}</p> : null}
        <ModalActions busy={submitting} busyLabel="Deleting..." cancelDisabled={submitting} disabled={selectedCount === 0 || submitting} onCancel={onClose} onSubmit={onConfirm} submitLabel="Delete" submitType="button" submitVariant="danger-solid" />
      </div>
    </Modal>
  )
}
