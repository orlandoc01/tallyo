import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { UnderlineTabs, type UnderlineTabItem } from '../common/UnderlineTabs'
import { PlaidTab } from './PlaidTab'
import { SimpleFinTab } from './SimpleFinTab'

type ProviderTab = 'plaid' | 'simplefin'

const TABS: UnderlineTabItem<ProviderTab>[] = [
  { value: 'plaid', children: 'Plaid' },
  { value: 'simplefin', children: 'SimpleFIN' },
]

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-950">Connections</h1>
        <p className="mt-1 text-sm text-neutral-500">Manage bank data providers and their linked institutions.</p>
      </div>

      <UnderlineTabs ariaLabel="Connection providers" items={TABS} value={activeTab} onChange={handleTabChange} />

      {activeTab === 'plaid' ? <PlaidTab /> : <SimpleFinTab />}
    </div>
  )
}

function providerTabFromParam(value: string | null): ProviderTab | null {
  if (value === 'plaid' || value === 'simplefin') return value
  return null
}
