import type { FormEvent } from 'react'
import { useIsMobile } from '../../hooks/useIsMobile'
import { FormError, TextField } from '../common/FormControls'
import { CenteredSpinner } from '../common/LoadingSpinner'
import { Modal, ModalActions } from '../common/Modal'
import { ModalHeader } from '../common/ModalHeader'
import { ChainPicker } from './ChainPicker'
import { LinkEVMWalletSheet } from './LinkEVMWalletSheet'
import { OwnerLoadStatus, OwnerSelectField } from './OwnerSelectField'
import { useLinkEVMWalletForm, type LinkEVMWalletPayload } from './useLinkEVMWalletForm'

export function LinkEVMWalletModal({
  onClose,
  onLinked,
}: {
  onClose: () => void
  onLinked: (payload: LinkEVMWalletPayload) => void
}) {
  const isMobile = useIsMobile()
  const form = useLinkEVMWalletForm({ onLinked })
  const { address, canSubmit, chainIds, label, owners, ownersError, ownersFetching, canCreateOwner, selectedOwner, submitError, submitting } = form

  if (isMobile) return <LinkEVMWalletSheet form={form} onClose={onClose} />

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void form.submit()
  }

  return (
    <Modal dismissOnBackdrop={!submitting} onClose={onClose} size="lg">
      <ModalHeader onClose={onClose} subtitle="Enter a wallet address to track its balance across chains." title="Link crypto wallet" />

      <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
        {submitting ? (
          <CenteredSpinner />
        ) : (
          <>
            <OwnerLoadStatus error={ownersError} fetching={ownersFetching} />

            <TextField
              autoComplete="off"
              controlClassName="font-mono"
              label="Wallet address"
              labelSuffix={<span className="text-negative"> *</span>}
              onChange={form.setAddress}
              placeholder="0x…"
              spellCheck={false}
              type="text"
              value={address}
            />

            <TextField ariaLabel="Wallet label" label="Label" labelSuffix={<span className="text-xs font-normal text-text-muted"> (optional)</span>} onChange={form.setLabel} placeholder="e.g. Main wallet" type="text" value={label} />

            <OwnerSelectField
              canCreateOwner={canCreateOwner}
              owners={owners}
              ownersError={ownersError}
              ownersFetching={ownersFetching}
              selectedOwner={selectedOwner}
              setSelectedOwner={form.setSelectedOwner}
              onOwnerCreated={form.handleOwnerCreated}
            />

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-text-1">
                Chains <span className="text-negative">*</span>
              </legend>
              <ChainPicker chainIds={chainIds} onChange={form.setChainIds} />
              {chainIds.length === 0 ? <p className="mt-1 text-xs text-negative">Select at least one chain.</p> : null}
            </fieldset>

            {submitError ? <FormError>{submitError}</FormError> : null}
          </>
        )}

        <ModalActions busy={submitting} busyLabel="Linking…" className="pt-1" disabled={!canSubmit} onCancel={onClose} submitLabel="Link wallet" />
      </form>
    </Modal>
  )
}
