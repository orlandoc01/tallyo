import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useAccounts } from '../../hooks/useEntityQueries'
import type { Account, HoldingRollup, NetWorthReport } from '../../types/graphql'
import { assetFromNetWorthReport } from '../../utils/netWorth'
import type { AccountDetailTab } from '../institutions/AccountDetailModal'
import { isAssetEditTab, type AssetEditTab } from './assetEditTabs'

// URL-driven modal state for the net worth page: /net-worth/accounts/:id/:tab
// and /net-worth/assets/:id/:tab open the account and asset modals. Unknown
// tab params normalize to the default tab; real-estate holdings open their
// backing account instead of the asset.
export function useNetWorthModalRoutes(report: NetWorthReport | null) {
  const navigate = useNavigate()
  const location = useLocation()
  const { account_id: selectedAccountId, account_tab: selectedAccountTabParam, asset_id: selectedAssetId, asset_tab: selectedAssetTabParam } = useParams()
  const { accounts, fetching: accountsFetching } = useAccounts({ includeLatestSnapshot: Boolean(selectedAccountId) })
  const selectedAccount = selectedAccountId && !accountsFetching ? accounts.find((account) => account.id === selectedAccountId) ?? null : null
  const selectedAccountTab: AccountDetailTab = selectedAccountTabParam === 'info' ? 'info' : 'valuation'
  const selectedAssetTab: AssetEditTab = selectedAssetTabParam === 'tracking' ? 'tracking' : 'info'
  const selectedAsset = selectedAssetId && report ? assetFromNetWorthReport(report, selectedAssetId) : null

  const openAccountValuation = useCallback((account: Account) => {
    navigate(netWorthAccountValuationPath(account.id, location.search))
  }, [location.search, navigate])
  const openAsset = useCallback((holding: HoldingRollup) => {
    const account = holding.asset.assetType === 'REAL_ESTATE' ? holding.holdings?.[0]?.account : undefined
    if (account) {
      navigate(netWorthAccountValuationPath(account.id, location.search))
      return
    }
    navigate(netWorthAssetInfoPath(holding.asset.id, location.search))
  }, [location.search, navigate])
  const closeModal = useCallback(() => {
    navigate(`/net-worth${location.search}`)
  }, [location.search, navigate])

  useEffect(() => {
    if (!selectedAccountId || selectedAccountTabParam === undefined || isAccountDetailTab(selectedAccountTabParam)) return
    navigate(netWorthAccountValuationPath(selectedAccountId, location.search), { replace: true })
  }, [location.search, navigate, selectedAccountId, selectedAccountTabParam])

  useEffect(() => {
    if (!selectedAssetId || selectedAssetTabParam === undefined || isAssetEditTab(selectedAssetTabParam)) return
    navigate(netWorthAssetInfoPath(selectedAssetId, location.search), { replace: true })
  }, [location.search, navigate, selectedAssetId, selectedAssetTabParam])

  return { closeModal, openAccountValuation, openAsset, selectedAccount, selectedAccountTab, selectedAsset, selectedAssetTab, tabSearch: location.search }
}

function netWorthAccountValuationPath(accountID: string, search: string) {
  return `/net-worth/accounts/${accountID}/valuation${search}`
}

function netWorthAssetInfoPath(assetID: string, search: string) {
  return `/net-worth/assets/${assetID}/info${search}`
}

function isAccountDetailTab(tab: string): tab is AccountDetailTab {
  return tab === 'info' || tab === 'valuation'
}
