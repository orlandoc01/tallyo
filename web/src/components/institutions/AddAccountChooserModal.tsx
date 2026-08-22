import { House, Landmark } from 'lucide-react'
import { Modal } from '../common/Modal'
import { ModalHeader } from '../common/ModalHeader'
import { ChooserTile } from './ChooserTile'

export function AddAccountChooserModal({ onSelectManualAccount, onSelectRealEstate, onClose }: { onSelectManualAccount: () => void; onSelectRealEstate: () => void; onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <ModalHeader onClose={onClose} subtitle="Choose the account you want to add manually." title="Add account" />

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <ChooserTile icon={House} label="Add Home" onClick={onSelectRealEstate} />
        <ChooserTile icon={Landmark} label="Add Manual account" onClick={onSelectManualAccount} />
      </div>
    </Modal>
  )
}
