import { Client, createClient, fetchExchange } from 'urql'
import { cacheExchange } from '@urql/exchange-graphcache'
import { authorizedFetch } from '../auth/tokenStore'
import { getApiBaseUrl } from '../utils/apiUrl'
import schemaIntrospection from './schema.json'
import { accountMutationUpdaters } from './cache/accounts'
import { adminMutationUpdaters } from './cache/admin'
import { budgetMutationUpdaters } from './cache/budgets'
import { categoryMutationUpdaters } from './cache/categories'
import { ruleMutationUpdaters } from './cache/rules'
import { transactionMutationUpdaters, transactionsPagination } from './cache/transactions'
import { wealthMutationUpdaters } from './cache/wealth'

export function createGraphqlClient(): Client {
  return createClient({
    url: `${getApiBaseUrl()}/query`,
    exchanges: [
      cacheExchange({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schema: schemaIntrospection as any,
        resolvers: {
          Query: {
            transactions: transactionsPagination(),
          },
        },
        keys: {
          // Value objects and report types are not independently cacheable
          PageInfo: () => null,
          TransactionConnection: () => null,
          TransactionEdge: () => null,
          TransactionsSummary: () => null,
          TransactionsStagedForCategorization: () => null,
          SpendingByCategoryReport: () => null,
          SpendingAggregatePeriod: () => null,
          CategorySpendingAggregate: () => null,
          CategorySpendingPeriod: () => null,
          CashFlowReport: () => null,
          CashFlowPeriod: () => null,
          CashFlowSummary: () => null,
          CashFlowBreakdown: () => null,
          NetWorthReport: () => null,
          HistoricalNetWorthReport: () => null,
          NetWorthPoint: () => null,
          ClassifierHistoryPoint: () => null,
          LiabilityHistoryPoint: () => null,
          ClassifierBreakdown: () => null,
          LiabilityBreakdown: () => null,
          HoldingRollup: () => null,
          Holding: () => null,
          AssetSnapshot: () => null,
          AnalysisReport: () => null,
          AnalysisSlice: () => null,
          AnalysisHolding: () => null,
          BudgetReport: () => null,
          BudgetReportHistory: () => null,
          BudgetSection: () => null,
          BudgetLine: () => null,
          Configuration: () => null,
          Locale: () => null,
          GeneralConfiguration: () => null,
          AuthorizationConfiguration: () => null,
          LlmCategorizationConfiguration: () => null,
          OllamaProviderConfiguration: () => null,
          GoogleAuthnConfiguration: () => null,
          PassKeyAuthnConfiguration: () => null,
          EmailCodeAuthnConfiguration: () => null,
          McpConfiguration: () => null,
          SecurityConfiguration: () => null,
          // Envelope list wrappers
          AccountList: () => null,
          CategoryList: () => null,
          CategoryGroupList: () => null,
          TagList: () => null,
          RuleList: () => null,
          AssetList: () => null,
          BalanceSnapshotReviewList: () => null,
          OwnerList: () => null,
          PlaidItemList: () => null,
          PlaidCredentialList: () => null,
          SimpleFinAccessTokenList: () => null,
          ConnectionList: () => null,
          EVMChainList: () => null,
          RecurringChargeList: () => null,
          UserList: () => null,
          // Report/aggregate subtypes
          AssetAdapterSource: () => null,
          AssetQuote: () => null,
			ItemSyncResult: () => null,
          CreateLinkTokenPayload: () => null,
          ResolveBalanceReviewPayload: () => null,
          // Union member types with no `id` — key EVMWallet by address, store Address as embedded
          EVMWallet: (data) => (data as { address?: string }).address ?? null,
          CryptoAssetDetails: () => null,
          RealEstateAssetDetails: () => null,
          Address: () => null,
        },
        updates: {
          Mutation: {
            ...transactionMutationUpdaters,
            ...categoryMutationUpdaters,
            ...ruleMutationUpdaters,
            ...accountMutationUpdaters,
            ...wealthMutationUpdaters,
            ...budgetMutationUpdaters,
            ...adminMutationUpdaters,
          },
        },
      }),
      fetchExchange,
    ],
    fetch: authorizedFetch,
  })
}
