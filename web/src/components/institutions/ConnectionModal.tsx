import clsx from 'clsx'
import { useState } from 'react'
import type { CreateSimpleFinAccessTokenPayload, ExchangePublicTokenPayload } from '../../types/graphql'
import { Modal } from '../common/Modal'
import { PlaidConnectionForm } from './AddAccountFlow'
import { SimpleFinConnectionForm } from './SimpleFinConnectionForm'

type ConnectionTab = 'plaid' | 'simplefin'

const TABS: { value: ConnectionTab; label: string; description: string }[] = [
  { value: 'plaid', label: 'Plaid', description: 'Use Plaid Link for bank and brokerage accounts.' },
  { value: 'simplefin', label: 'SimpleFIN', description: 'Claim a SimpleFIN Bridge setup token.' },
]

export function ConnectionModal({
  initialTab = 'plaid',
  onClose,
  onPlaidLinked,
  onSimpleFinLinked,
}: {
  initialTab?: ConnectionTab
  onClose: () => void
  onPlaidLinked: (payload: ExchangePublicTokenPayload) => void
  onSimpleFinLinked: (payload: CreateSimpleFinAccessTokenPayload) => void
}) {
  const [activeTab, setActiveTab] = useState<ConnectionTab>(initialTab)

  return (
    <Modal dismissOnBackdrop={false} label="Link Connection" onClose={onClose} size="lg">
      <div>
        <h2 className="text-lg font-semibold text-text-1">Link Connection</h2>
        <p className="mt-1 text-sm text-text-3">Choose how this provider connection should be linked.</p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2" role="tablist" aria-label="Bank data providers">
        {TABS.map((tab) => (
          <button
            aria-selected={activeTab === tab.value}
            className={clsx(
              'rounded-xl border px-4 py-3 text-left text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30',
              activeTab === tab.value ? 'border-brand-500 bg-brand-50 text-text-1' : 'border-border text-text-3 hover:border-brand-300 hover:text-text-1',
            )}
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            role="tab"
            type="button"
          >
            <span className="block">{tab.label}</span>
            <span className="mt-0.5 hidden text-xs font-normal text-text-3 sm:block">{tab.description}</span>
          </button>
        ))}
      </div>

      {activeTab === 'plaid' ? (
        <PlaidConnectionForm onClose={onClose} onLinked={onPlaidLinked} />
      ) : (
        <SimpleFinConnectionForm onClose={onClose} onLinked={onSimpleFinLinked} />
      )}
    </Modal>
  )
}
