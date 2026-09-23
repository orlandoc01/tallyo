import type { ReactNode } from 'react'
import { useIsMobile } from '../../hooks/useIsMobile'
import { MobileFilterDropdown } from '../common/MobileFilterDropdown'
import { Modal } from '../common/Modal'

export function TransactionDetailsOverlay({ children, label, onClose, titleId }: { children: ReactNode; label: string; onClose: () => void; titleId: string }) {
  const isMobile = useIsMobile()
  if (isMobile) {
    return (
      <MobileFilterDropdown bodyClassName="pb-8 pt-3" labelledBy={titleId} maxHeight="84%" onClose={onClose} title={null}>
        {children}
      </MobileFilterDropdown>
    )
  }
  return <Modal label={label} onClose={onClose} scrollable>{children}</Modal>
}
