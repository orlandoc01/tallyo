import { gql } from 'urql'

export const CATEGORY_FIELDS = gql`
  fragment CategoryFields on Category {
    __typename
    id
    name
    emoji
    groupName
    groupEmoji
    kind
    sortOrder
    plaidPFC2Codes
  }
`

export const TAG_FIELDS = gql`
  fragment TagFields on Tag {
    __typename
    id
    name
    color
  }
`

export const PLAID_PFC2_CODES_QUERY = gql`
  query PlaidPFC2Codes {
    plaidPFC2Codes
  }
`

export const PLAID_CREDENTIAL_FIELDS = gql`
  fragment PlaidCredentialFields on PlaidCredential {
    __typename
    id
    clientId
    environment
    label
    itemCount
    createdAt
  }
`

export const PLAID_ITEM_SUMMARY_FIELDS = gql`
  ${PLAID_CREDENTIAL_FIELDS}
  fragment PlaidItemSummaryFields on PlaidItem {
    __typename
    id
    institutionId
    lastSyncedAt
    healthState
    healthErrorCode
    healthErrorMessage
    syncCron
    recurringSyncCron
    nextSyncAt
    nextRecurringSyncAt
    isActive
    createdAt
    updatedAt
    credential {
      ...PlaidCredentialFields
    }
  }
`

export const OWNER_FIELDS = gql`
  fragment OwnerFields on Owner {
    __typename
    id
    name
  }
`

export const ACCOUNT_FIELDS = gql`
  ${OWNER_FIELDS}
  fragment AccountFields on Account {
    __typename
    id
    connection {
      __typename
      id
      name
      owner { ...OwnerFields }
      isActive
    }
    owner { ...OwnerFields }
    name
    type
    subtype
    mask
    notes
    closed
    hidden
    needsReview
    manual
    typeLocked
    accountWealthProperty {
      __typename
      ... on RealEstateAssetDetails {
        address {
          __typename
          street
          city
          state
          zip
          homeType
        }
      }
    }
    lastSyncedAt
    createdAt
    updatedAt
  }
`

export const TRANSACTION_FIELDS = gql`
  ${CATEGORY_FIELDS}
  ${ACCOUNT_FIELDS}
  ${TAG_FIELDS}
  fragment TransactionFields on Transaction {
    __typename
    id
    amount
    datetime
    postedDatetime
    merchantName
    originalName
    logoUrl
    pending
    isHidden
    isRecurring
    isReviewed
    notes
    plaidCategory
    createdAt
    updatedAt
    category {
      ...CategoryFields
    }
    account {
      ...AccountFields
    }
    tags {
      ...TagFields
    }
  }
`

export const TAGS_QUERY = gql`
  ${TAG_FIELDS}
  query Tags {
    tags {
      items {
        ...TagFields
        transactionCount
      }
    }
  }
`

export const EVM_CHAINS_QUERY = gql`
  query EVMChains {
    evmChains {
      items {
        id
        name
      }
    }
  }
`

export const CATEGORIES_QUERY = gql`
  ${CATEGORY_FIELDS}
  query Categories {
    categories {
      items {
        ...CategoryFields
      }
    }
  }
`

export const CATEGORY_GROUPS_QUERY = gql`
  ${CATEGORY_FIELDS}
  query CategoryGroups {
    categoryGroups {
      items {
        __typename
        id
        name
        emoji
        kind
        categories {
          ...CategoryFields
        }
      }
    }
  }
`

export const OWNERS_QUERY = gql`
  query Owners {
    owners {
      items {
        __typename
        id
        name
      }
    }
  }
`

export const ACCOUNTS_QUERY = gql`
  ${ACCOUNT_FIELDS}
  query Accounts {
    accounts {
      items {
        ...AccountFields
      }
    }
  }
`

export const ASSET_FIELDS = gql`
  fragment AssetFields on Asset {
    __typename
    id
    assetType
    identifier
    name
    classifier
    currentPrice
    forcedUsdPrice
    trackingTicker
    trackingMultiplier
    priceConnectivity
    investmentConnectivity
    adapterSources {
      sourceAdapter
      sourceId
    }
    details {
      __typename
      ... on RealEstateAssetDetails {
        address {
          __typename
          street
          city
          state
          zip
          homeType
        }
      }
    }
  }
`

// Snapshot totals/date only — safe for any caller with read:wealth. Holding
// rows are a separate fragment gated by read:holdings (see
// ACCOUNT_SNAPSHOT_FIELDS below); most callers only need this summary.
const ACCOUNT_SNAPSHOT_SUMMARY_FIELDS = gql`
  fragment AccountSnapshotSummaryFields on AccountSnapshot {
    __typename
    id
    accountId
    date
    balanceUSD
    netContributionUSD
    flagged
  }
`

const ACCOUNT_SNAPSHOT_FIELDS = gql`
  ${ASSET_FIELDS}
  ${ACCOUNT_SNAPSHOT_SUMMARY_FIELDS}
  fragment AccountSnapshotFields on AccountSnapshot {
    ...AccountSnapshotSummaryFields
    holdings {
      __typename
      assetId
      accountId
      asset { ...AssetFields }
      quantity
      valueUSD
      manual
    }
  }
`

export const ACCOUNT_WITH_SNAPSHOT_SUMMARY_FIELDS = gql`
  ${ACCOUNT_FIELDS}
  ${ACCOUNT_SNAPSHOT_SUMMARY_FIELDS}
  fragment AccountWithSnapshotSummaryFields on Account {
    ...AccountFields
    latestSnapshot {
      ...AccountSnapshotSummaryFields
    }
  }
`

export const ACCOUNT_WITH_SNAPSHOT_FIELDS = gql`
  ${ACCOUNT_FIELDS}
  ${ACCOUNT_SNAPSHOT_FIELDS}
  fragment AccountWithSnapshotFields on Account {
    ...AccountFields
    latestSnapshot {
      ...AccountSnapshotFields
    }
  }
`

export const ACCOUNTS_WITH_LATEST_SNAPSHOT_SUMMARY_QUERY = gql`
  ${ACCOUNT_WITH_SNAPSHOT_SUMMARY_FIELDS}
  query Accounts {
    accounts {
      items {
        ...AccountWithSnapshotSummaryFields
      }
    }
  }
`

export const ACCOUNTS_WITH_LATEST_SNAPSHOT_QUERY = gql`
  ${ACCOUNT_WITH_SNAPSHOT_FIELDS}
  query Accounts {
    accounts {
      items {
        ...AccountWithSnapshotFields
      }
    }
  }
`

export const ASSETS_QUERY = gql`
  ${ASSET_FIELDS}
  query Assets($input: AssetsInput) {
    assets(input: $input) {
      items {
        ...AssetFields
      }
    }
  }
`

// Adds latestSnapshot totals directly (not via ASSET_FIELDS, which stays out
// of latestSnapshot so Portfolio Tracker sessions — no read:assets — can keep
// using the shared fragment elsewhere). Totals need only read:assets; a null
// snapshot means "not held".
export const ASSETS_WITH_LATEST_SNAPSHOT_QUERY = gql`
  ${ASSET_FIELDS}
  query AssetsWithLatestSnapshot($input: AssetsInput) {
    assets(input: $input) {
      items {
        ...AssetFields
        latestSnapshot {
          asOfDate
          totalHeldQuantity
          totalHeldValueUSD
        }
      }
    }
  }
`

export const BALANCE_REVIEWS_QUERY = gql`
  ${OWNER_FIELDS}
  fragment BalanceReviewAccountFields on Account {
    __typename
    id
    owner { ...OwnerFields }
    name
    type
    subtype
    mask
    notes
    closed
    hidden
    manual
    createdAt
    updatedAt
  }
  query BalanceReviews {
    balanceSnapshotReviews {
      items {
        __typename
        id
        account {
          ...BalanceReviewAccountFields
        }
        firstFlaggedDate
        latestFlaggedDate
        flaggedSnapshotCount
        providerBalanceUSD
        carryForwardBalanceUSD
        flagReason
        createdAt
        updatedAt
      }
    }
  }
`

const NET_WORTH_ACCOUNT_FIELDS = gql`
  ${ACCOUNT_FIELDS}
  fragment NetWorthAccountFields on Account {
    ...AccountFields
    latestSnapshot { balanceUSD netContributionUSD }
  }
`

export const NET_WORTH_QUERY = gql`
  ${ASSET_FIELDS}
  ${NET_WORTH_ACCOUNT_FIELDS}
  query NetWorth($input: NetWorthInput!, $includeHoldings: Boolean!) {
    netWorth(input: $input) {
      asOfDate
      currentNetWorthUSD
      currentAssetsUSD
      currentLiabilitiesUSD
      classifierBreakdown {
        classifier
        label
        valueUSD
        percentOfAssets
        assetCount
        holdings {
          asset {
            ...AssetFields
          }
          totalQuantity
          valueUSD
          holdings @include(if: $includeHoldings) {
            valueUSD
            account {
              ...NetWorthAccountFields
            }
          }
        }
      }
      liabilityBreakdown {
        category
        label
        valueUSD
        percentOfLiabilities
        accountCount
        accounts {
          ...NetWorthAccountFields
        }
      }
    }
  }
`

export const HISTORICAL_NET_WORTH_QUERY = gql`
  query HistoricalNetWorth($input: HistoricalNetWorthInput!) {
    historicalNetWorth(input: $input) {
      series {
        date
        totalAssetsUSD
        totalLiabilitiesUSD
        netWorthUSD
      }
      classifierSeries {
        date
        classifier
        label
        valueUSD
      }
      liabilitySeries {
        date
        category
        label
        valueUSD
      }
    }
  }
`

export const ANALYSIS_QUERY = gql`
  ${ASSET_FIELDS}
  query Analysis($input: AnalysisInput!) {
    analysis(input: $input) {
      __typename
      view
      totalValueUSD
      slices {
        __typename
        label
        valueUSD
        percent
        holdings {
          __typename
          asset {
            ...AssetFields
          }
          valueUSD
          percent
        }
      }
    }
  }
`

export const PLAID_CREDENTIALS_QUERY = gql`
  ${PLAID_CREDENTIAL_FIELDS}
  query PlaidCredentials {
    plaidCredentials {
      items {
        ...PlaidCredentialFields
      }
    }
  }
`

export const CONFIGURATION_FIELDS = gql`
  fragment ConfigurationFields on Configuration {
    configFilePath
    dbPath
    port
    syncOff
    locale { timezone }
    general {
      disableTransactionTracking
      disableWealthTracking
      hideOwners
    }
    authorization {
      masterPassword
      disableAllAuth
      oauthIssuerUrl
      frontendRedirectUris
      accessTokenLifetime
      refreshTokenLifetime
      devCorsAllowedOrigins
    }
    llmCategorization {
      enabled
      ollama {
        url
        model
      }
    }
    googleAuthn {
      enabled
      googleClientId
      googleClientSecret
    }
    passKeyAuthn {
      enabled
      webauthnRpId
      webauthnRpName
      webauthnRpOrigins
    }
    emailCodeAuthn {
      enabled
      smtpHost
      smtpPort
      smtpFrom
      smtpUsername
      smtpPassword
    }
    mcp {
      enabled
      dynamicRedirectHosts
    }
    security {
      trustedProxyCidrs
    }
  }
`

export const CONFIGURATION_QUERY = gql`
  ${CONFIGURATION_FIELDS}
  query Configuration {
    configuration {
      ...ConfigurationFields
    }
  }
`

export const GENERAL_CONFIGURATION_QUERY = gql`
  query GeneralConfiguration {
    generalConfiguration {
      disableTransactionTracking
      disableWealthTracking
      hideOwners
    }
  }
`

export const INSTANCE_TIMEZONE_QUERY = gql`
  query InstanceTimezone {
    instanceTimezone
  }
`

const SIMPLE_FIN_CONNECTION_FIELDS = gql`
  fragment SimpleFinConnectionFields on SimpleFinConnection {
    __typename
    id
    orgDomain
    orgUrl
    lastSyncedAt
    createdAt
    updatedAt
  }
`

export const CONNECTION_PROVIDER_FIELDS = gql`
  ${PLAID_CREDENTIAL_FIELDS}
  ${PLAID_ITEM_SUMMARY_FIELDS}
  ${SIMPLE_FIN_CONNECTION_FIELDS}
  fragment ConnectionProviderFields on ConnectionProvider {
    __typename
    ... on PlaidItem {
      ...PlaidItemSummaryFields
    }
    ... on EVMWallet {
      address
      chainIds
    }
    ... on SimpleFinConnection {
      ...SimpleFinConnectionFields
    }
  }
`

export const CONNECTIONS_QUERY = gql`
  ${ACCOUNT_FIELDS}
  ${CONNECTION_PROVIDER_FIELDS}
  query Connections($input: ConnectionsInput) {
    connections(input: $input) {
      items {
        __typename
        id
        name
        owner { ...OwnerFields }
        isActive
        provider {
          ...ConnectionProviderFields
          ... on PlaidItem {
            accounts {
              ...AccountFields
            }
          }
          ... on SimpleFinConnection {
            accounts {
              ...AccountFields
            }
          }
        }
      }
    }
  }
`

export const SIMPLE_FIN_ACCESS_TOKENS_QUERY = gql`
  ${ACCOUNT_FIELDS}
  ${SIMPLE_FIN_CONNECTION_FIELDS}
  query SimpleFinAccessTokens {
    simpleFinAccessTokens {
      items {
        __typename
        id
        label
        owner { ...OwnerFields }
        syncCron
        lastSyncedAt
        nextSyncAt
        createdAt
        connections {
          ...SimpleFinConnectionFields
          accounts {
            ...AccountFields
          }
        }
      }
    }
  }
`

export const PLAID_ITEMS_QUERY = gql`
  ${ACCOUNT_FIELDS}
  ${PLAID_ITEM_SUMMARY_FIELDS}
  query PlaidItems($input: PlaidItemsInput) {
    plaidItems(input: $input) {
      items {
        ...PlaidItemSummaryFields
        accounts {
          ...AccountFields
        }
      }
    }
  }
`

export const TRANSACTIONS_QUERY = gql`
  ${TRANSACTION_FIELDS}
  query Transactions($input: TransactionsInput!) {
    transactions(input: $input) {
      edges {
        node {
          ...TransactionFields
        }
        cursor
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
`

export const TRANSACTIONS_STAGED_FOR_CATEGORIZATION_QUERY = gql`
  query TransactionsStagedForCategorization {
    transactionsStagedForCategorization {
      count
    }
  }
`

export const TRANSACTION_IDS_QUERY = gql`
  query TransactionIds($input: TransactionsInput) {
    transactions(input: $input) {
      edges {
        node {
          id
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
    }
  }
`

export const SPENDING_BY_CATEGORY_QUERY = gql`
  ${CATEGORY_FIELDS}
  query SpendingByCategory($filter: SpendingFilter!) {
    spendingByCategory(filter: $filter) {
      totalAmount
      transactionCount
      periods {
        periodLabel
        periodStart
        periodEnd
        totalAmount
        transactionCount
      }
      categories {
        category {
          ...CategoryFields
        }
        totalAmount
        transactionCount
        percentOfTotal
        periods {
          periodLabel
          periodStart
          periodEnd
          totalAmount
          transactionCount
          percentOfTotal
        }
      }
    }
  }
`

export const RECURRING_CHARGES_QUERY = gql`
  ${TRANSACTION_FIELDS}
  query RecurringCharges {
    recurringCharges {
      items {
        __typename
        id
        merchantName
        estimatedAmount
        interval
        status
        isActive
        lastDate
        nextExpectedDate
        category {
          ...CategoryFields
        }
        transactions {
          ...TransactionFields
        }
      }
    }
  }
`

export const CASH_FLOW_QUERY = gql`
  ${CATEGORY_FIELDS}
  query CashFlow($filter: SpendingFilter!) {
    cashFlow(filter: $filter) {
      periods {
        periodLabel
        periodStart
        periodEnd
        summary {
          income
          expenses
          savings
        }
        incomeByCategory {
          category {
            ...CategoryFields
          }
          total
          transactionCount
          percentOfTotal
        }
        expensesByCategory {
          category {
            ...CategoryFields
          }
          total
          transactionCount
          percentOfTotal
        }
      }
    }
  }
`

export const SPENDING_TOTALS_QUERY = gql`
  query SpendingTotals($filter: SpendingFilter!) {
    spendingByCategory(filter: $filter) {
      totalAmount
      periods {
        periodStart
        totalAmount
      }
    }
  }
`

export const TRANSACTIONS_SUMMARY_QUERY = gql`
  query TransactionsSummary($filter: TransactionsFilter) {
    transactionsSummary(filter: $filter) {
      totalCount
      totalAmount
      averageAmount
      largestAmount
      firstDate
      lastDate
    }
  }
`

export const USERS_QUERY = gql`
  query Users {
    users {
      items {
        __typename
        id
        email
        role
        createdAt
      }
    }
  }
`

export const RULES_QUERY = gql`
  ${ACCOUNT_FIELDS}
  ${CATEGORY_FIELDS}
  ${TAG_FIELDS}
  query Rules($input: RulesInput) {
    rules(input: $input) {
      items {
        __typename
        id
        merchantPattern
        originalPattern
        merchantName
        shouldHide
        shouldBeRecurring
        accounts {
          ...AccountFields
        }
        amountMin
        amountMax
        priority
        createdAt
        category {
          ...CategoryFields
        }
        tags {
          ...TagFields
        }
      }
    }
  }
`

// EVM provider lookup only — the Info tab must not select protected snapshot
// Holdings. Balance/date summaries and valuation data come from the account
// list query and AccountSnapshotEditor's own documents respectively.
export const ACCOUNT_QUERY = gql`
  ${ACCOUNT_FIELDS}
  query Account($id: ID!) {
    account(id: $id) {
      ...AccountFields
      connection {
        provider {
          __typename
          ... on EVMWallet {
            address
            chainIds
          }
        }
      }
    }
  }
`

export const ACCOUNT_SNAPSHOT_QUERY = gql`
  ${ACCOUNT_SNAPSHOT_FIELDS}
  query AccountSnapshot($input: AccountSnapshotInput!) {
    accountSnapshot(input: $input) {
      ...AccountSnapshotFields
    }
  }
`

export const ACCOUNT_SNAPSHOTS_QUERY = gql`
  ${ACCOUNT_SNAPSHOT_FIELDS}
  query AccountSnapshots($input: AccountSnapshotsInput!) {
    accountSnapshots(input: $input) {
      edges {
        node {
          ...AccountSnapshotFields
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
    }
  }
`

export const ASSET_QUOTE_QUERY = gql`
  query AssetQuote($ticker: String!) {
    assetQuote(ticker: $ticker) {
      ticker
      priceUSD
      asOf
    }
  }
`

export const ASSET_LATEST_SNAPSHOT_QUERY = gql`
  query AssetLatestSnapshot($assetId: ID!) {
    node(id: $assetId) {
      __typename
      ... on Asset {
        id
        latestSnapshot {
          asOfDate
          totalHeldQuantity
          totalHeldValueUSD
          holdings {
            __typename
            accountId
            valueUSD
            account {
              __typename
              id
              name
              mask
            }
          }
        }
      }
    }
  }
`

const BUDGET_REPORT_TOTALS_FIELDS = gql`
  fragment BudgetReportTotalsFields on BudgetReport {
    __typename
    month
    expensesBudgeted
    expensesActual
    incomeBudgeted
    incomeActual
    remainingBudgeted
    remainingActual
  }
`

const BUDGET_REPORT_SECTIONS_FIELDS = gql`
  ${CATEGORY_FIELDS}
  fragment BudgetReportSectionsFields on BudgetReport {
    sections {
      label
      budgeted
      actual
      remaining
      group {
        id
        name
        emoji
        kind
      }
      lines {
        id
        budgeted
        actual
        remaining
        category { ...CategoryFields }
      }
    }
  }
`

export const BUDGET_REPORT_QUERY = gql`
  ${BUDGET_REPORT_TOTALS_FIELDS}
  ${BUDGET_REPORT_SECTIONS_FIELDS}
  query BudgetReport($input: BudgetReportInput!) {
    budgetReport(input: $input) {
      ...BudgetReportTotalsFields
      ...BudgetReportSectionsFields
    }
  }
`

export const BUDGET_REPORT_HISTORY_QUERY = gql`
  ${BUDGET_REPORT_TOTALS_FIELDS}
  query BudgetReportHistory($input: BudgetReportHistoryInput) {
    budgetReportHistory(input: $input) {
      items {
        ...BudgetReportTotalsFields
      }
    }
  }
`

export const BUDGET_REPORT_HISTORY_WITH_SECTIONS_QUERY = gql`
  ${BUDGET_REPORT_TOTALS_FIELDS}
  ${BUDGET_REPORT_SECTIONS_FIELDS}
  query BudgetReportHistoryWithSections($input: BudgetReportHistoryInput) {
    budgetReportHistory(input: $input) {
      items {
        ...BudgetReportTotalsFields
        ...BudgetReportSectionsFields
      }
    }
  }
`
