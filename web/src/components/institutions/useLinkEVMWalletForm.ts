import { useState } from 'react'
import { useMutation } from 'urql'
import { LINK_EVM_WALLET_MUTATION } from '../../graphql/mutations'
import { useSaveAction } from '../../hooks/useSaveAction'
import type { Account, Connection, LinkEVMWalletInput } from '../../types/graphql'
import { useLinkOwners } from './useLinkOwners'

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const DEFAULT_CHAIN_IDS = ['eth']

export interface LinkEVMWalletPayload {
  connection: Connection
  account: Account
}

export function useLinkEVMWalletForm({ onLinked }: { onLinked: (payload: LinkEVMWalletPayload) => void }) {
  const owners = useLinkOwners()
  const [address, setAddress] = useState('')
  const [label, setLabel] = useState('')
  const [chainIds, setChainIds] = useState(DEFAULT_CHAIN_IDS)
  const [, linkWallet] = useMutation<{ linkEVMWallet: LinkEVMWalletPayload }, { input: LinkEVMWalletInput }>(LINK_EVM_WALLET_MUTATION)
  const { error: submitError, saving: submitting, save } = useSaveAction()

  const canSubmit = EVM_ADDRESS_RE.test(address) && !!owners.selectedOwner && chainIds.length > 0 && !submitting

  async function submit() {
    if (!canSubmit) return

    await save(
      () => linkWallet({ input: { address, ownerId: owners.selectedOwner, label: label || null, chainIds } }),
      (result) => { if (result.data?.linkEVMWallet) onLinked(result.data.linkEVMWallet) },
    )
  }

  return { ...owners, address, canSubmit, chainIds, label, setAddress, setChainIds, setLabel, submit, submitError, submitting }
}
