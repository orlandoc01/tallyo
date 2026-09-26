import { useIsMobile } from '../../hooks/useIsMobile'
import { Modal } from '../common/Modal'
import { TransactionDetailsPane, type TransactionDetailsPaneProps } from './TransactionDetailsPane'
import { TransactionDetailsSheet } from './TransactionDetailsSheet'

export function TransactionDetailsOverlay({ label, ...pane }: TransactionDetailsPaneProps & { label: string; titleId: string }) {
  const isMobile = useIsMobile()
  if (isMobile) return <TransactionDetailsSheet key={pane.transaction.id} {...pane} />
  return (
    <Modal label={label} onClose={pane.onClose} scrollable>
      <TransactionDetailsPane key={pane.transaction.id} {...pane} />
    </Modal>
  )
}
