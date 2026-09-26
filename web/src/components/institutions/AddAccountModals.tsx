import { useIsMobile } from '../../hooks/useIsMobile'
import type { CreateSimpleFinAccessTokenPayload, ExchangePublicTokenPayload } from '../../types/graphql'
import { ActionSheet } from '../common/ActionSheet'
import { AddAccountChooserModal } from './AddAccountChooserModal'
import { ConnectionModal } from './ConnectionModal'
import { LinkEVMWalletModal } from './LinkEVMWalletModal'
import { LinkRealEstateModal } from './LinkRealEstateModal'
import { ProviderChooserModal } from './ProviderChooserModal'

export type LinkingStep = 'chooser' | 'add-account' | 'bank' | 'evm' | 'realestate' | null

// The link/add account modal flow: provider and account-type choosers plus the
// bank, crypto-wallet, and real-estate link modals. Reports a confirmation
// message and resets the step when a flow completes.
export function AddAccountModals({
  step,
  onManualAccount,
  onMessage,
  onStepChange,
}: {
  step: LinkingStep
  onManualAccount: () => void
  onMessage: (message: string) => void
  onStepChange: (step: LinkingStep) => void
}) {
  const isMobile = useIsMobile()

  function finish(message: string) {
    onMessage(message)
    onStepChange(null)
  }

  function handlePlaidLinked(payload: ExchangePublicTokenPayload) {
    const name = payload.accounts[0]?.connection?.name || 'institution'
    finish(`Connected ${name} with ${payload.accounts.length} accounts.`)
  }

  function handleSimpleFinLinked(payload: CreateSimpleFinAccessTokenPayload) {
    finish(`Connected SimpleFIN with ${payload.connections.length} connection${payload.connections.length === 1 ? '' : 's'} and ${payload.accounts.length} account${payload.accounts.length === 1 ? '' : 's'}.`)
  }

  const chooserOpen = step === 'chooser' || step === 'add-account'

  return (
    <>
      {chooserOpen && isMobile ? (
        <ActionSheet
          items={[
            { label: 'Link a bank', onSelect: () => onStepChange('bank') },
            { label: 'Link a crypto wallet', onSelect: () => onStepChange('evm') },
            { label: 'Add manual account', onSelect: () => { onStepChange(null); onManualAccount() } },
            { label: 'Add home', onSelect: () => onStepChange('realestate') },
          ]}
          onClose={() => onStepChange(null)}
          title="Add account"
        />
      ) : null}

      {step === 'chooser' && !isMobile ? (
        <ProviderChooserModal
          onClose={() => onStepChange(null)}
          onSelectBank={() => onStepChange('bank')}
          onSelectEVM={() => onStepChange('evm')}
        />
      ) : null}

      {step === 'add-account' && !isMobile ? (
        <AddAccountChooserModal
          onClose={() => onStepChange(null)}
          onSelectManualAccount={() => {
            onStepChange(null)
            onManualAccount()
          }}
          onSelectRealEstate={() => onStepChange('realestate')}
        />
      ) : null}

      {step === 'bank' ? (
        <ConnectionModal onClose={() => onStepChange(null)} onPlaidLinked={handlePlaidLinked} onSimpleFinLinked={handleSimpleFinLinked} />
      ) : null}

      {step === 'evm' ? (
        <LinkEVMWalletModal
          onClose={() => onStepChange(null)}
          onLinked={() => finish('Crypto wallet linked. Balance sync running in the background.')}
        />
      ) : null}

      {step === 'realestate' ? (
        <LinkRealEstateModal
          onClose={() => onStepChange(null)}
          onLinked={() => finish('Home linked and valuation saved.')}
        />
      ) : null}
    </>
  )
}
