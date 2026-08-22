import { useState } from 'react'
import { useMutation } from 'urql'
import { LINK_EVM_WALLET_MUTATION } from '../../graphql/mutations'
import type { Account, Connection, LinkEVMWalletInput } from '../../types/graphql'
import { FormError, TextField } from '../common/FormControls'
import { CenteredSpinner } from '../common/LoadingSpinner'
import { Modal, ModalActions } from '../common/Modal'
import { ModalHeader } from '../common/ModalHeader'
import { useSaveAction } from '../../hooks/useSaveAction'
import { ChainPicker } from './ChainPicker'
import { OwnerLoadStatus, OwnerSelectField } from './OwnerSelectField'
import { useLinkOwners } from './useLinkOwners'

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const DEFAULT_CHAIN_IDS = ['eth']

interface LinkEVMWalletPayload {
  connection: Connection
  account: Account
}

export function LinkEVMWalletModal({
  onClose,
  onLinked,
}: {
  onClose: () => void
  onLinked: (payload: LinkEVMWalletPayload) => void
}) {
  const { owners, ownersFetching, ownersError, canCreateOwner, selectedOwner, setSelectedOwner, handleOwnerCreated } = useLinkOwners()
  const [address, setAddress] = useState('')
  const [label, setLabel] = useState('')
  const [chainIds, setChainIds] = useState(DEFAULT_CHAIN_IDS)
  const [addressError, setAddressError] = useState<string | null>(null)
  const [, linkWallet] = useMutation<
    { linkEVMWallet: LinkEVMWalletPayload },
    { input: LinkEVMWalletInput }
  >(LINK_EVM_WALLET_MUTATION)
  const { error: submitError, saving: submitting, save } = useSaveAction()

  function validateAddress(val: string) {
    if (!val) return 'Address is required.'
    if (!EVM_ADDRESS_RE.test(val)) return 'Must be a valid EVM address (0x followed by 40 hex characters).'
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const err = validateAddress(address)
    setAddressError(err)
    if (err || !selectedOwner) return

    await save(
      () => linkWallet({ input: { address, ownerId: selectedOwner, label: label || null, chainIds } }),
      (result) => { if (result.data?.linkEVMWallet) onLinked(result.data.linkEVMWallet) },
    )
  }

  const canSubmit = EVM_ADDRESS_RE.test(address) && !!selectedOwner && chainIds.length > 0 && !submitting
  const addressErrorId = addressError ? 'evm-wallet-address-error' : undefined

  return (
    <Modal dismissOnBackdrop={!submitting} onClose={onClose} size="lg">
      <ModalHeader onClose={onClose} subtitle="Enter a wallet address to track its balance across chains." title="Link crypto wallet" />

      <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
        {submitting ? (
          <CenteredSpinner />
        ) : (
          <>
            <OwnerLoadStatus error={ownersError} fetching={ownersFetching} />

            <div>
              <TextField
                aria-describedby={addressErrorId}
                aria-invalid={!!addressError}
                autoComplete="off"
                controlClassName="font-mono"
                label="Wallet address"
                labelSuffix={<span className="text-red-500"> *</span>}
                onChange={(value) => {
                  setAddress(value)
                  setAddressError(null)
                }}
                placeholder="0x…"
                spellCheck={false}
                type="text"
                value={address}
              />
              {addressError ? <p className="mt-1 text-xs text-red-600" id={addressErrorId}>{addressError}</p> : null}
            </div>

            <TextField ariaLabel="Wallet label" label="Label" labelSuffix={<span className="text-xs font-normal text-neutral-400"> (optional)</span>} onChange={setLabel} placeholder="e.g. Main wallet" type="text" value={label} />

            <OwnerSelectField
              canCreateOwner={canCreateOwner}
              owners={owners}
              ownersError={ownersError}
              ownersFetching={ownersFetching}
              selectedOwner={selectedOwner}
              setSelectedOwner={setSelectedOwner}
              onOwnerCreated={handleOwnerCreated}
            />

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-neutral-950">
                Chains <span className="text-red-500">*</span>
              </legend>
              <ChainPicker chainIds={chainIds} onChange={setChainIds} />
              {chainIds.length === 0 ? <p className="mt-1 text-xs text-red-600">Select at least one chain.</p> : null}
            </fieldset>

            {submitError ? <FormError>{submitError}</FormError> : null}
          </>
        )}

        <ModalActions busy={submitting} busyLabel="Linking…" className="pt-1" disabled={!canSubmit} onCancel={onClose} submitLabel="Link wallet" />
      </form>
    </Modal>
  )
}
