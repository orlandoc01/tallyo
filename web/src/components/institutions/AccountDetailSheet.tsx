import type { Account } from '../../types/graphql'
import { accountMaskedName, accountNetContributionUSD } from '../../utils/accounts'
import { institutionColor } from '../../utils/colors'
import { formatSignedCurrency } from '../../utils/currency'
import { Button } from '../common/Button'
import { FormError } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetAvatar, SheetHero, SheetMeta } from '../common/SheetHero'
import { SheetTabs } from '../common/SheetTabs'
import { AccountInfoSheetRows } from './AccountInfoSheetRows'
import { accountMetaRows } from './accountMeta'
import { AccountValuationSheet } from './AccountValuationSheet'
import { useAccountInfoForm } from './useAccountInfoForm'

export type AccountDetailTab = 'info' | 'valuation'

export interface AccountDetailSheetProps {
  account: Account
  basePath: string
  canReadValuation: boolean
  currentTab: AccountDetailTab
  error: string | null
  evmProviderError: boolean
  institution: string
  loadingEVMProvider: boolean
  onAccountUpdate: (account: Account) => void
  onClose: () => void
  onDelete?: (account: Account) => void
  onError: (message: string | null) => void
  tabSearch: string
}

export function AccountDetailSheet({ account, basePath, canReadValuation, currentTab, error, evmProviderError, institution, loadingEVMProvider, onAccountUpdate, onClose, onDelete, onError, tabSearch }: AccountDetailSheetProps) {
  const form = useAccountInfoForm({ account, onAccountUpdate, onClose, onDelete, onError })
  const balance = accountNetContributionUSD(account)
  const displayName = accountMaskedName(account)
  const showInfo = currentTab === 'info' && !loadingEVMProvider && !evmProviderError
  const removeAction = form.canWriteAccounts && account.manual ? (
    <Button className="touch-manipulation" disabled={form.isSaving || form.isDeleting} onClick={() => { void form.handleRemoveManualAccount() }} size="sm" variant={form.confirmingDelete ? 'danger-solid' : 'ghost'}>
      {form.isDeleting ? 'Removing…' : form.confirmingDelete ? 'Confirm remove' : 'Remove'}
    </Button>
  ) : undefined
  const footer = currentTab === 'info' ? (
    <MobileFilterFooter
      primaryDisabled={form.canWriteAccounts && form.disableSave}
      primaryLabel={form.canWriteAccounts ? (form.isSaving ? 'Saving…' : 'Save') : 'Done'}
      secondaryLabel="View transactions"
      secondaryVariant="outline-accent"
      onPrimary={form.canWriteAccounts ? () => { void form.handleSave().then((saved) => { if (saved) onClose() }) } : onClose}
      onSecondary={form.isProperty ? undefined : form.handleViewTransactions}
    />
  ) : <MobileFilterFooter primaryLabel="Done" onPrimary={onClose} />

  return (
    <MobileSheet action={removeAction} bodyClassName="pb-2" footer={footer} hideClose labelledBy="account-detail-title" maxHeight="84%" onClose={onClose} title="Account">
      <div aria-label={`Details for ${displayName}`} role="region">
        <SheetHero
          avatar={<SheetAvatar color={institutionColor(institution)} glyph={institution.charAt(0).toUpperCase()} />}
          sub={institution}
          title={displayName}
          value={balance === null ? '—' : formatSignedCurrency(balance)}
        />
        <SheetMeta rows={accountMetaRows(account, institution)} />
        <SheetTabs
          ariaLabel="Account detail sections"
          items={canReadValuation
            ? [{ to: `${basePath}/info${tabSearch}`, children: 'Info' }, { to: `${basePath}/valuation${tabSearch}`, children: 'Valuation' }]
            : [{ to: `${basePath}/info${tabSearch}`, children: 'Info' }]}
        />
        {error ? <FormError className="mt-3">{error}</FormError> : null}
        {currentTab === 'info' && loadingEVMProvider ? <p className="mt-4 text-sm text-text-3" role="status">Loading wallet chains…</p> : null}
        {currentTab === 'info' && evmProviderError ? <FormError className="mt-3">Could not load wallet chains.</FormError> : null}
        {showInfo ? <div className="mt-2"><AccountInfoSheetRows account={account} form={form} /></div> : null}
        {currentTab === 'valuation' && canReadValuation ? <AccountValuationSheet account={account} key={`${account.id}:${account.latestSnapshot?.date ?? ''}`} onAccountUpdate={onAccountUpdate} /> : null}
      </div>
    </MobileSheet>
  )
}
