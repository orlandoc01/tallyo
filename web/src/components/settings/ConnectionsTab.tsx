import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { SegmentedControl } from '../common/SegmentedControl'
import { PlaidTab } from './PlaidTab'
import { SimpleFinTab } from './SimpleFinTab'

type ProviderTab = 'plaid' | 'simplefin'

const PROVIDER_OPTIONS = [
  { value: 'plaid', label: 'Plaid' },
  { value: 'simplefin', label: 'SimpleFIN' },
] as const

const DEFAULT_PROVIDER_TAB: ProviderTab = 'plaid'

export function ConnectionsTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = providerTabFromParam(searchParams.get('provider')) ?? DEFAULT_PROVIDER_TAB

  useEffect(() => {
    if (providerTabFromParam(searchParams.get('provider'))) return
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('provider', DEFAULT_PROVIDER_TAB)
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  function handleTabChange(tab: ProviderTab) {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('provider', tab)
    setSearchParams(nextParams)
  }

  return (
    <div className="space-y-3">
      <div className="flex">
        <SegmentedControl ariaLabel="Connection providers" onChange={handleTabChange} options={PROVIDER_OPTIONS} value={activeTab} />
      </div>
      {activeTab === 'plaid' ? <PlaidTab /> : <SimpleFinTab />}
    </div>
  )
}

function providerTabFromParam(value: string | null): ProviderTab | null {
  if (value === 'plaid' || value === 'simplefin') return value
  return null
}
