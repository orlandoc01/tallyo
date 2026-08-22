import { Landmark, Wallet } from 'lucide-react'
import { Modal } from '../common/Modal'
import { ModalHeader } from '../common/ModalHeader'
import { ChooserTile } from './ChooserTile'

export function ProviderChooserModal({
  onSelectEVM,
  onSelectBank,
  onClose,
}: {
  onSelectEVM: () => void
  onSelectBank: () => void
  onClose: () => void
}) {
  return (
    <Modal onClose={onClose}>
      <ModalHeader onClose={onClose} subtitle="Choose the connection you want to link." title="Link Connection" />

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <ChooserTile icon={Wallet} label="Crypto wallet" onClick={onSelectEVM} />
        <ChooserTile icon={Landmark} label="Bank / brokerage" onClick={onSelectBank} />
      </div>
    </Modal>
  )
}
