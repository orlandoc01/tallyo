import type { Account, Asset, AssetClassifier, ClassifierBreakdown, ClassifierHistoryPoint, Holding, HoldingRollup, NetWorthPoint } from '../types/graphql'
import { accounts, accountSnapshots, assets } from './fixtures'

interface StubAccount {
  id: string
  name: string
  type: Account['type']
  subtype: string | null
  base: string
  manual?: boolean
}

interface StubHolding {
  account: string
  quantity: number | null
  valueUSD: number
}

interface StubClassifier {
  classifier: AssetClassifier
  label: string
  rollups: Array<{ asset: Asset; rows: StubHolding[] }>
}

const asset = (base: Asset, overrides: Partial<Asset>): Asset => ({ ...base, adapterSources: [], details: null, ...overrides })
const [usd, vti, eth, primaryHome, acme, bnd, qqq, , vffvx] = assets
const btc = asset(eth, { id: 'asset-btc', identifier: 'BTC', name: 'Bitcoin', currentPrice: 65000 })
const sol = asset(eth, { id: 'asset-sol', identifier: 'SOL', name: 'Solana', currentPrice: 150 })
const usdc = asset(eth, { id: 'asset-usdc', identifier: 'USDC', name: 'USD Coin', classifier: 'STABLECOIN', currentPrice: 1 })
const usdt = asset(eth, { id: 'asset-usdt', identifier: 'USDT', name: 'Tether', classifier: 'STABLECOIN', currentPrice: 1 })
const dai = asset(eth, { id: 'asset-dai', identifier: 'DAI', name: 'Dai', classifier: 'STABLECOIN', currentPrice: 1 })
const nimbus = asset(acme, { id: 'asset-nimbus', identifier: 'NIMBUS', name: 'Nimbus Robotics (private)', currentPrice: 4 })
const lumen = asset(acme, { id: 'asset-lumen', identifier: 'LUMEN', name: 'Lumen Labs SAFE', currentPrice: null })
const property = (id: string, name: string, price: number) => asset(primaryHome, { id: `asset-${id}`, identifier: id, name, currentPrice: price, forcedUsdPrice: price })
const duplex = property('rental-duplex', 'Rental Duplex', 620000)
const cabin = property('lake-cabin', 'Lake Cabin', 310000)
const condo = property('rental-condo', 'Rental Condo', 385000)
const lot = property('vacant-lot', 'Vacant Lot', 45000)

// `base` names a fixture account whose connection/owner the stub account borrows.
const stubAccounts: StubAccount[] = [
  { id: 'acct-cash-checking', name: 'Checking', type: 'DEPOSITORY', subtype: 'checking', base: 'acct-1' },
  { id: 'acct-cash-savings', name: 'Savings', type: 'DEPOSITORY', subtype: 'savings', base: 'acct-2' },
  { id: 'acct-cash-emergency', name: 'Emergency Fund', type: 'DEPOSITORY', subtype: 'savings', base: 'acct-6' },
  { id: 'acct-cash-money-market', name: 'Money Market', type: 'DEPOSITORY', subtype: 'money market', base: 'acct-18' },
  { id: 'acct-cash-vacation', name: 'Vacation Savings', type: 'DEPOSITORY', subtype: 'savings', base: 'acct-7' },
  { id: 'acct-invest-roth-401k', name: 'Roth 401k', type: 'INVESTMENT', subtype: 'roth 401k', base: 'acct-11' },
  { id: 'acct-invest-401k', name: '401k', type: 'INVESTMENT', subtype: '401k', base: 'acct-13' },
  { id: 'acct-invest-roth-ira', name: 'Roth IRA', type: 'INVESTMENT', subtype: 'roth ira', base: 'acct-12' },
  { id: 'acct-invest-brokerage', name: 'Brokerage', type: 'INVESTMENT', subtype: 'brokerage', base: 'acct-11' },
  { id: 'acct-invest-hsa', name: 'HSA Investments', type: 'INVESTMENT', subtype: 'hsa', base: 'acct-14' },
  { id: 'manual-company-equity', name: 'Acme Company Equity', type: 'INVESTMENT', subtype: 'manual investment', base: 'manual-company-equity', manual: true },
  { id: 'manual-acme-rsu', name: 'Acme RSUs', type: 'INVESTMENT', subtype: 'manual investment', base: 'manual-company-equity', manual: true },
  { id: 'manual-acme-espp', name: 'Acme ESPP', type: 'INVESTMENT', subtype: 'manual investment', base: 'manual-company-equity', manual: true },
  { id: 'manual-nimbus-options', name: 'Nimbus Options', type: 'OTHER', subtype: 'private equity', base: 'manual-company-equity', manual: true },
  { id: 'manual-lumen-safe', name: 'Lumen Labs Angel', type: 'OTHER', subtype: 'private equity', base: 'manual-company-equity', manual: true },
  { id: 'acct-evm', name: 'Main Wallet', type: 'CRYPTO_WALLET', subtype: null, base: 'acct-evm' },
  { id: 'acct-wallet-cold', name: 'Cold Storage', type: 'CRYPTO_WALLET', subtype: null, base: 'acct-evm' },
  { id: 'acct-wallet-hot', name: 'Hot Wallet', type: 'CRYPTO_WALLET', subtype: null, base: 'acct-evm' },
  { id: 'acct-wallet-exchange', name: 'Coinbase', type: 'CRYPTO_WALLET', subtype: null, base: 'acct-evm' },
  { id: 'acct-wallet-ledger', name: 'Ledger Nano', type: 'CRYPTO_WALLET', subtype: null, base: 'acct-evm' },
  { id: 'acct-real-estate', name: 'Primary Home', type: 'PROPERTY', subtype: 'single family', base: 'acct-real-estate' },
  { id: 'acct-property-duplex', name: 'Rental Duplex', type: 'PROPERTY', subtype: 'multi family', base: 'acct-real-estate' },
  { id: 'acct-property-cabin', name: 'Lake Cabin', type: 'PROPERTY', subtype: 'single family', base: 'acct-real-estate' },
  { id: 'acct-property-condo', name: 'Rental Condo', type: 'PROPERTY', subtype: 'condo', base: 'acct-real-estate' },
  { id: 'acct-property-lot', name: 'Vacant Lot', type: 'PROPERTY', subtype: 'land', base: 'acct-real-estate' },
]

const stubClassifiers: StubClassifier[] = [
  { classifier: 'CASH', label: 'Cash', rollups: [
    { asset: usd, rows: [
      { account: 'acct-cash-checking', quantity: 4500, valueUSD: 4500 },
      { account: 'acct-cash-savings', quantity: 12800, valueUSD: 12800 },
      { account: 'acct-cash-emergency', quantity: 25000, valueUSD: 25000 },
      { account: 'acct-cash-money-market', quantity: 9600, valueUSD: 9600 },
      { account: 'acct-cash-vacation', quantity: 3200, valueUSD: 3200 },
    ] },
  ] },
  { classifier: 'PUBLIC', label: 'Public markets', rollups: [
    { asset: vffvx, rows: [
      { account: 'acct-invest-401k', quantity: 1275.55, valueUSD: 88000 },
      { account: 'acct-invest-roth-401k', quantity: 898.68, valueUSD: 62000 },
    ] },
    { asset: vti, rows: [
      { account: 'acct-invest-roth-ira', quantity: 148.82, valueUSD: 41000 },
      { account: 'acct-invest-brokerage', quantity: 130.67, valueUSD: 36000 },
      { account: 'acct-invest-hsa', quantity: 41.74, valueUSD: 11500 },
    ] },
    { asset: qqq, rows: [{ account: 'acct-invest-brokerage', quantity: 48, valueUSD: 24000 }] },
    { asset: bnd, rows: [{ account: 'acct-invest-roth-ira', quantity: 124.69, valueUSD: 9000 }] },
  ] },
  { classifier: 'COMPANY_EQUITY', label: 'Company Equity', rollups: [
    { asset: acme, rows: [
      { account: 'manual-acme-rsu', quantity: 400, valueUSD: 60000 },
      { account: 'manual-acme-espp', quantity: 120, valueUSD: 18000 },
      { account: 'manual-company-equity', quantity: 10, valueUSD: 1500 },
    ] },
    { asset: nimbus, rows: [{ account: 'manual-nimbus-options', quantity: 5000, valueUSD: 20000 }] },
    { asset: lumen, rows: [{ account: 'manual-lumen-safe', quantity: null, valueUSD: 15000 }] },
  ] },
  { classifier: 'CRYPTOCURRENCY', label: 'Cryptocurrency', rollups: [
    { asset: btc, rows: [
      { account: 'acct-wallet-cold', quantity: 0.4, valueUSD: 26000 },
      { account: 'acct-wallet-exchange', quantity: 0.1, valueUSD: 6500 },
    ] },
    { asset: eth, rows: [
      { account: 'acct-wallet-ledger', quantity: 3, valueUSD: 10200 },
      { account: 'acct-evm', quantity: 2.5, valueUSD: 8500 },
      { account: 'acct-wallet-exchange', quantity: 1, valueUSD: 3400 },
      { account: 'acct-wallet-hot', quantity: 0.8, valueUSD: 2720 },
    ] },
    { asset: sol, rows: [{ account: 'acct-wallet-hot', quantity: 40, valueUSD: 6000 }] },
  ] },
  { classifier: 'STABLECOIN', label: 'Stablecoins', rollups: [
    { asset: usdc, rows: [
      { account: 'acct-wallet-cold', quantity: 12000, valueUSD: 12000 },
      { account: 'acct-evm', quantity: 4000, valueUSD: 4000 },
      { account: 'acct-wallet-exchange', quantity: 3000, valueUSD: 3000 },
    ] },
    { asset: dai, rows: [{ account: 'acct-wallet-ledger', quantity: 2500, valueUSD: 2500 }] },
    { asset: usdt, rows: [{ account: 'acct-wallet-hot', quantity: 1500, valueUSD: 1500 }] },
  ] },
  { classifier: 'REAL_ESTATE', label: 'Real Estate', rollups: [
    { asset: primaryHome, rows: [{ account: 'acct-real-estate', quantity: 1, valueUSD: 1450000 }] },
    { asset: duplex, rows: [{ account: 'acct-property-duplex', quantity: 1, valueUSD: 620000 }] },
    { asset: condo, rows: [{ account: 'acct-property-condo', quantity: 1, valueUSD: 385000 }] },
    { asset: cabin, rows: [{ account: 'acct-property-cabin', quantity: 1, valueUSD: 310000 }] },
    { asset: lot, rows: [{ account: 'acct-property-lot', quantity: 1, valueUSD: 45000 }] },
  ] },
]

const allRows = stubClassifiers.flatMap((group) => group.rollups.flatMap((rollup) => rollup.rows))
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const round2 = (value: number) => Math.round(value * 100) / 100

function stubAccount(stub: StubAccount, scale: number): Account {
  const base = accounts.find((account) => account.id === stub.base) ?? accounts[0]
  const balanceUSD = round2(sum(allRows.filter((row) => row.account === stub.id).map((row) => row.valueUSD)) * scale)
  return {
    ...base,
    id: stub.id,
    name: stub.name,
    type: stub.type,
    subtype: stub.subtype,
    manual: stub.manual ?? false,
    closed: false,
    hidden: false,
    latestSnapshot: { ...accountSnapshots[0], id: `snapshot-${stub.id}`, accountId: stub.id, balanceUSD, netContributionUSD: balanceUSD, holdings: [] },
    lastSyncedAt: '2026-05-21T10:00:00Z',
  }
}

export const stubNetWorthAssetsUSD = sum(allRows.map((row) => row.valueUSD))

// `scale` shrinks every value for as-of-date requests so a chart click visibly changes the report.
export function stubClassifierBreakdown(includeHoldings: boolean, scale = 1): ClassifierBreakdown[] {
  const accountsById = new Map(stubAccounts.map((stub) => [stub.id, stubAccount(stub, scale)]))
  const totalUSD = stubNetWorthAssetsUSD * scale
  return stubClassifiers.map((group) => {
    const valueUSD = round2(sum(group.rollups.flatMap((rollup) => rollup.rows.map((row) => row.valueUSD))) * scale)
    const holdings = group.rollups.map((rollup): HoldingRollup => {
      const rollupUSD = round2(sum(rollup.rows.map((row) => row.valueUSD)) * scale)
      const rows = rollup.rows.map((row): Holding => {
        const account = accountsById.get(row.account) ?? accounts[0]
        return { __typename: 'Holding', assetId: rollup.asset.id, asset: rollup.asset, accountId: account.id, account, quantity: row.quantity, valueUSD: round2(row.valueUSD * scale), manual: account.manual }
      })
      return {
        __typename: 'HoldingRollup',
        asset: rollup.asset,
        totalQuantity: rollup.rows.every((row) => row.quantity != null) ? round2(sum(rollup.rows.map((row) => row.quantity ?? 0))) : null,
        valueUSD: rollupUSD,
        percentOfClassifier: round2((rollupUSD / valueUSD) * 100),
        holdings: includeHoldings ? rows : null,
      }
    })
    return { __typename: 'ClassifierBreakdown', classifier: group.classifier, label: group.label, valueUSD, percentOfAssets: round2((valueUSD / totalUSD) * 100), assetCount: group.rollups.length, holdings }
  })
}

const historyDates = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01']
const historyScales = [0.86, 0.89, 0.93, 0.96, 0.985]

export function stubNetWorthHistory(liabilitiesUSD: number): { series: NetWorthPoint[]; classifierSeries: ClassifierHistoryPoint[] } {
  const breakdown = stubClassifierBreakdown(false)
  return {
    series: historyDates.map((date, index) => {
      const totalAssetsUSD = round2(stubNetWorthAssetsUSD * historyScales[index])
      const totalLiabilitiesUSD = round2(liabilitiesUSD * (1 + (historyDates.length - 1 - index) * 0.03))
      return { __typename: 'NetWorthPoint', date, totalAssetsUSD, totalLiabilitiesUSD, netWorthUSD: round2(totalAssetsUSD - totalLiabilitiesUSD) }
    }),
    classifierSeries: historyDates.flatMap((date, index) => breakdown.map((group): ClassifierHistoryPoint => (
      { __typename: 'ClassifierHistoryPoint', date, classifier: group.classifier, label: group.label, valueUSD: round2(group.valueUSD * historyScales[index]) }
    ))),
  }
}
