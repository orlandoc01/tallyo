// AUTO-GENERATED from ../schema/*.graphql by scripts/generate-types.mjs.
// Do not edit by hand — run `npm run generate:types` instead.

export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
/** All built-in and custom scalars, mapped to their actual values */
export interface Scalars {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  Date: { input: string; output: string; }
  DateTime: { input: string; output: string; }
  Money: { input: number; output: number; }
}

export type AccountType =
  | 'DEPOSITORY'
  | 'CREDIT'
  | 'LOAN'
  | 'INVESTMENT'
  | 'OTHER'
  | 'PROPERTY'
  | 'CRYPTO_WALLET';

export type PlaidEnvironment =
  | 'SANDBOX'
  | 'DEVELOPMENT'
  | 'PRODUCTION';

export type PlaidItemHealthState =
  | 'HEALTHY'
  | 'LINK_UPDATE_REQUIRED'
  | 'SYNC_ERROR';

/** A household owner that accounts and connections are attributed to. */
export interface Owner extends Node {
  __typename?: 'Owner';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
}

export interface OwnerList {
  __typename?: 'OwnerList';
  items: Array<Owner>;
}

export interface Account extends Node {
  __typename?: 'Account';
  id: Scalars['ID']['output'];
  /** The data provider connection for this account. Null for manual accounts. */
  connection?: Maybe<Connection>;
  owner: Owner;
  name: Scalars['String']['output'];
  type: AccountType;
  subtype?: Maybe<Scalars['String']['output']>;
  /** Last 4 digits of the account number. Null for manually created accounts. */
  mask?: Maybe<Scalars['String']['output']>;
  /** Free-form documentation notes visible only in account details. */
  notes?: Maybe<Scalars['String']['output']>;
  closed: Scalars['Boolean']['output'];
  hidden: Scalars['Boolean']['output'];
  /**
   * True when the provider could not infer the account type and defaulted it.
   * Cleared when a user sets or confirms the type via updateAccount.
   */
  needsReview: Scalars['Boolean']['output'];
  /** True for accounts created manually (not synced from Plaid). */
  manual: Scalars['Boolean']['output'];
  /** True when the account type is managed by its backing link and cannot be edited directly. */
  typeLocked: Scalars['Boolean']['output'];
  lastSyncedAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
  updatedAt: Scalars['DateTime']['output'];
  /** Most recent account snapshot, including the per-asset holdings captured for that local day. */
  latestSnapshot?: Maybe<AccountSnapshot>;
  /** Wealth-owned property details for PROPERTY accounts backed by linked assets. */
  accountWealthProperty?: Maybe<AccountWealthProperty>;
}

export interface AccountList {
  __typename?: 'AccountList';
  items: Array<Account>;
}

/** An EVM wallet. Balances are synced across chains via an external provider. */
export interface EVMWallet {
  __typename?: 'EVMWallet';
  address: Scalars['String']['output'];
  chainIds: Array<Scalars['String']['output']>;
}

export interface EVMChain {
  __typename?: 'EVMChain';
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
}

export interface EVMChainList {
  __typename?: 'EVMChainList';
  items: Array<EVMChain>;
}

/** A linked SimpleFIN connection (one institution under an Access Token). */
export interface SimpleFinConnection extends Node {
  __typename?: 'SimpleFinConnection';
  id: Scalars['ID']['output'];
  orgDomain?: Maybe<Scalars['String']['output']>;
  orgUrl?: Maybe<Scalars['String']['output']>;
  accounts: Array<Account>;
  lastSyncedAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
  updatedAt: Scalars['DateTime']['output'];
}

/** A claimed SimpleFIN Access Token. The underlying Access URL is write-only. */
export interface SimpleFinAccessToken extends Node {
  __typename?: 'SimpleFinAccessToken';
  id: Scalars['ID']['output'];
  label?: Maybe<Scalars['String']['output']>;
  owner: Owner;
  connections: Array<SimpleFinConnection>;
  syncCron: Scalars['String']['output'];
  lastSyncedAt?: Maybe<Scalars['DateTime']['output']>;
  nextSyncAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
}

export interface SimpleFinAccessTokenList {
  __typename?: 'SimpleFinAccessTokenList';
  items: Array<SimpleFinAccessToken>;
}

/** A Plaid item or other data provider. */
export type ConnectionProvider = PlaidItem | EVMWallet | SimpleFinConnection;

/**
 * A generic connection abstraction over any data provider (Plaid, Debank, etc.).
 * Each connection maps to a row in the `connections` table via (source_table, source_id).
 */
export interface Connection extends Node {
  __typename?: 'Connection';
  id: Scalars['ID']['output'];
  /** Institution or display name for this provider connection. */
  name?: Maybe<Scalars['String']['output']>;
  owner: Owner;
  isActive: Scalars['Boolean']['output'];
  provider?: Maybe<ConnectionProvider>;
}

export interface ConnectionList {
  __typename?: 'ConnectionList';
  items: Array<Connection>;
}

/**
 * A linked Plaid connection representing one financial institution. Each item
 * holds an access token and sync cursor, and maps to one or more Accounts.
 */
export interface PlaidItem extends Node {
  __typename?: 'PlaidItem';
  id: Scalars['ID']['output'];
  credential: PlaidCredential;
  /** Plaid institution ID (e.g. "ins_3"). */
  institutionId?: Maybe<Scalars['String']['output']>;
  accounts: Array<Account>;
  lastSyncedAt?: Maybe<Scalars['DateTime']['output']>;
  /** Current Plaid Item health state. LINK_UPDATE_REQUIRED means use Link update mode. */
  healthState: PlaidItemHealthState;
  /** Last Plaid error code that changed healthState, if any. */
  healthErrorCode?: Maybe<Scalars['String']['output']>;
  /** Last Plaid error message that changed healthState, if any. */
  healthErrorMessage?: Maybe<Scalars['String']['output']>;
  /** When the current healthState was last written. */
  healthUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  syncCron: Scalars['String']['output'];
  recurringSyncCron: Scalars['String']['output'];
  nextSyncAt?: Maybe<Scalars['DateTime']['output']>;
  nextRecurringSyncAt?: Maybe<Scalars['DateTime']['output']>;
  /** Whether this item is actively syncing. False = soft-deleted. */
  isActive: Scalars['Boolean']['output'];
  createdAt: Scalars['DateTime']['output'];
  updatedAt: Scalars['DateTime']['output'];
}

export interface PlaidItemList {
  __typename?: 'PlaidItemList';
  items: Array<PlaidItem>;
}

export interface ConnectionsInput {
  includeInactive?: InputMaybe<Scalars['Boolean']['input']>;
}

export interface PlaidItemsInput {
  includeInactive?: InputMaybe<Scalars['Boolean']['input']>;
}

export interface CreateSimpleFinAccessTokenInput {
  /** The base64-encoded one-time Setup Token from SimpleFIN Bridge. */
  setupToken: Scalars['String']['input'];
  ownerId: Scalars['ID']['input'];
  label?: InputMaybe<Scalars['String']['input']>;
}

export interface CreateSimpleFinAccessTokenPayload {
  __typename?: 'CreateSimpleFinAccessTokenPayload';
  accessToken: SimpleFinAccessToken;
  connections: Array<SimpleFinConnection>;
  accounts: Array<Account>;
}

export interface CreateOwnerInput {
  name: Scalars['String']['input'];
}

export interface CreateManualAccountInput {
  /** The Connection (provider) this account is grouped under. Null for truly manual accounts. */
  connectionId?: InputMaybe<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
  ownerId: Scalars['ID']['input'];
  type: AccountType;
  notes?: InputMaybe<Scalars['String']['input']>;
  closed?: InputMaybe<Scalars['Boolean']['input']>;
  hidden?: InputMaybe<Scalars['Boolean']['input']>;
}

export interface CreateManualAccountPayload {
  __typename?: 'CreateManualAccountPayload';
  account: Account;
}

export interface UpdateAccountInput {
  id: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  ownerId?: InputMaybe<Scalars['ID']['input']>;
  type?: InputMaybe<AccountType>;
  /** Plaid account subtype (e.g. "checking", "credit card"). Must be a valid Plaid subtype string. */
  subtype?: InputMaybe<Scalars['String']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  closed?: InputMaybe<Scalars['Boolean']['input']>;
  hidden?: InputMaybe<Scalars['Boolean']['input']>;
}

export interface UpdateAccountPayload {
  __typename?: 'UpdateAccountPayload';
  account: Account;
}

export interface RemoveManualAccountInput {
  id: Scalars['ID']['input'];
}

export interface RemoveManualAccountPayload {
  __typename?: 'RemoveManualAccountPayload';
  success: Scalars['Boolean']['output'];
}

export interface UpdateConnectionInput {
  connectionId: Scalars['ID']['input'];
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
  syncCron?: InputMaybe<Scalars['String']['input']>;
  recurringSyncCron?: InputMaybe<Scalars['String']['input']>;
  chainIds?: InputMaybe<Array<Scalars['String']['input']>>;
}

export interface UpdateConnectionPayload {
  __typename?: 'UpdateConnectionPayload';
  connection: Connection;
}

export interface DeleteConnectionInput {
  connectionId: Scalars['ID']['input'];
}

export interface DeleteConnectionPayload {
  __typename?: 'DeleteConnectionPayload';
  success: Scalars['Boolean']['output'];
}

export interface LinkEVMWalletInput {
  /** EVM address (0x followed by 40 hex characters). */
  address: Scalars['String']['input'];
  chainIds: Array<Scalars['String']['input']>;
  ownerId: Scalars['ID']['input'];
  /** Human-readable label; defaults to a truncated version of the address. */
  label?: InputMaybe<Scalars['String']['input']>;
}

export interface LinkEVMWalletPayload {
  __typename?: 'LinkEVMWalletPayload';
  connection: Connection;
  account: Account;
}

export interface CreateLinkTokenInput {
  credentialId: Scalars['Int']['input'];
  ownerId: Scalars['ID']['input'];
}

export interface CreateLinkTokenPayload {
  __typename?: 'CreateLinkTokenPayload';
  linkToken: Scalars['String']['output'];
  expiration: Scalars['DateTime']['output'];
}

export interface ExchangePublicTokenInput {
  publicToken: Scalars['String']['input'];
  credentialId: Scalars['Int']['input'];
  ownerId: Scalars['ID']['input'];
  institutionId?: InputMaybe<Scalars['String']['input']>;
  institutionName?: InputMaybe<Scalars['String']['input']>;
}

export interface ExchangePublicTokenPayload {
  __typename?: 'ExchangePublicTokenPayload';
  item: PlaidItem;
  /** Accounts discovered during the initial item sync. */
  accounts: Array<Account>;
}

export interface CompleteLinkUpdatePayload {
  __typename?: 'CompleteLinkUpdatePayload';
  item: PlaidItem;
}

/** Access role assigned to a user. */
export type Role =
  | 'ADMIN'
  | 'WRITER'
  | 'READONLY'
  | 'SPEND_TRACKER'
  | 'CASHFLOW_TRACKER'
  | 'NET_WORTH_TRACKER'
  | 'PORTFOLIO_TRACKER';

/** A user authorized to access the dashboard. */
export interface User extends Node {
  __typename?: 'User';
  id: Scalars['ID']['output'];
  email: Scalars['String']['output'];
  role: Role;
  createdAt: Scalars['DateTime']['output'];
}

export interface UserList {
  __typename?: 'UserList';
  items: Array<User>;
}

/** Resolved server configuration. Secret values are obfuscated. */
export interface Configuration {
  __typename?: 'Configuration';
  configFilePath?: Maybe<Scalars['String']['output']>;
  dbPath: Scalars['String']['output'];
  port: Scalars['String']['output'];
  syncOff: Scalars['Boolean']['output'];
  locale: Locale;
  general: GeneralConfiguration;
  authorization: AuthorizationConfiguration;
  llmCategorization: LlmCategorizationConfiguration;
  googleAuthn: GoogleAuthnConfiguration;
  passKeyAuthn: PassKeyAuthnConfiguration;
  emailCodeAuthn: EmailCodeAuthnConfiguration;
  mcp: McpConfiguration;
  security: SecurityConfiguration;
}

export interface GeneralConfiguration {
  __typename?: 'GeneralConfiguration';
  disableTransactionTracking: Scalars['Boolean']['output'];
  disableWealthTracking: Scalars['Boolean']['output'];
  hideOwners: Scalars['Boolean']['output'];
}

export interface AuthorizationConfiguration {
  __typename?: 'AuthorizationConfiguration';
  masterPassword?: Maybe<Scalars['String']['output']>;
  disableAllAuth: Scalars['Boolean']['output'];
  oauthIssuerUrl: Scalars['String']['output'];
  frontendRedirectUris: Array<Scalars['String']['output']>;
  accessTokenLifetime: Scalars['String']['output'];
  refreshTokenLifetime: Scalars['String']['output'];
  devCorsAllowedOrigins?: Maybe<Array<Scalars['String']['output']>>;
}

/** LLM transaction-categorization backend. */
export type LlmProvider =
  | 'OLLAMA';

export interface LlmCategorizationConfiguration {
  __typename?: 'LlmCategorizationConfiguration';
  enabled: Scalars['Boolean']['output'];
  provider: LlmProvider;
  /** Providers selectable in this deployment. */
  allowedProviders: Array<LlmProvider>;
  ollama: OllamaProviderConfiguration;
}

export interface OllamaProviderConfiguration {
  __typename?: 'OllamaProviderConfiguration';
  url?: Maybe<Scalars['String']['output']>;
  model: Scalars['String']['output'];
}

export interface GoogleAuthnConfiguration {
  __typename?: 'GoogleAuthnConfiguration';
  enabled: Scalars['Boolean']['output'];
  googleClientId?: Maybe<Scalars['String']['output']>;
  googleClientSecret?: Maybe<Scalars['String']['output']>;
}

export interface PassKeyAuthnConfiguration {
  __typename?: 'PassKeyAuthnConfiguration';
  enabled: Scalars['Boolean']['output'];
  webauthnRpId?: Maybe<Scalars['String']['output']>;
  webauthnRpName: Scalars['String']['output'];
  webauthnRpOrigins?: Maybe<Array<Scalars['String']['output']>>;
}

export interface EmailCodeAuthnConfiguration {
  __typename?: 'EmailCodeAuthnConfiguration';
  enabled: Scalars['Boolean']['output'];
  smtpHost?: Maybe<Scalars['String']['output']>;
  smtpPort: Scalars['String']['output'];
  smtpFrom?: Maybe<Scalars['String']['output']>;
  smtpUsername?: Maybe<Scalars['String']['output']>;
  smtpPassword?: Maybe<Scalars['String']['output']>;
}

export interface McpConfiguration {
  __typename?: 'McpConfiguration';
  enabled: Scalars['Boolean']['output'];
  /** Hosts allowed as HTTPS redirect URIs for dynamically registered MCP clients. */
  dynamicRedirectHosts?: Maybe<Array<Scalars['String']['output']>>;
}

export interface SecurityConfiguration {
  __typename?: 'SecurityConfiguration';
  trustedProxyCidrs: Array<Scalars['String']['output']>;
}

export interface Locale {
  __typename?: 'Locale';
  timezone: Scalars['String']['output'];
}

/**
 * A Plaid API credential pair (client_id + secret). Secrets are never exposed
 * via the API — only the client_id and metadata are returned.
 */
export interface PlaidCredential {
  __typename?: 'PlaidCredential';
  id: Scalars['Int']['output'];
  clientId: Scalars['String']['output'];
  environment: PlaidEnvironment;
  /** Human-readable label for credential selection UI (e.g. "Primary", "Overflow"). */
  label?: Maybe<Scalars['String']['output']>;
  /** Number of active PlaidItems using this credential. */
  itemCount: Scalars['Int']['output'];
  createdAt: Scalars['DateTime']['output'];
}

export interface PlaidCredentialList {
  __typename?: 'PlaidCredentialList';
  items: Array<PlaidCredential>;
}

export interface AddUserInput {
  email: Scalars['String']['input'];
  role?: InputMaybe<Role>;
}

export interface AddUserPayload {
  __typename?: 'AddUserPayload';
  user: User;
}

export interface CreateInviteLinkInput {
  userId: Scalars['ID']['input'];
}

export interface CreateInviteLinkPayload {
  __typename?: 'CreateInviteLinkPayload';
  url: Scalars['String']['output'];
  expiresAt: Scalars['DateTime']['output'];
}

export interface RemoveUserInput {
  id: Scalars['ID']['input'];
}

export interface RemoveUserPayload {
  __typename?: 'RemoveUserPayload';
  success: Scalars['Boolean']['output'];
}

export interface UpdateUserInput {
  id: Scalars['ID']['input'];
  role: Role;
}

export interface UpdateUserPayload {
  __typename?: 'UpdateUserPayload';
  user: User;
}

export interface CreatePlaidCredentialInput {
  clientId: Scalars['String']['input'];
  secret: Scalars['String']['input'];
  environment: PlaidEnvironment;
  label?: InputMaybe<Scalars['String']['input']>;
}

export interface CreatePlaidCredentialPayload {
  __typename?: 'CreatePlaidCredentialPayload';
  credential: PlaidCredential;
}

export interface UpdatePlaidCredentialInput {
  id: Scalars['Int']['input'];
  secret: Scalars['String']['input'];
  environment: PlaidEnvironment;
}

export interface UpdatePlaidCredentialPayload {
  __typename?: 'UpdatePlaidCredentialPayload';
  credential: PlaidCredential;
}

export interface DeletePlaidCredentialInput {
  id: Scalars['Int']['input'];
}

export interface DeletePlaidCredentialPayload {
  __typename?: 'DeletePlaidCredentialPayload';
  success: Scalars['Boolean']['output'];
}

export interface LlmCategorizationConfigurationInput {
  enabled: Scalars['Boolean']['input'];
  provider: LlmProvider;
  ollama: OllamaProviderConfigurationInput;
}

export interface OllamaProviderConfigurationInput {
  url?: InputMaybe<Scalars['String']['input']>;
  model: Scalars['String']['input'];
}

export interface GoogleAuthnConfigurationInput {
  enabled: Scalars['Boolean']['input'];
  googleClientId?: InputMaybe<Scalars['String']['input']>;
  googleClientSecret?: InputMaybe<Scalars['String']['input']>;
}

export interface PassKeyAuthnConfigurationInput {
  enabled: Scalars['Boolean']['input'];
  webauthnRpId?: InputMaybe<Scalars['String']['input']>;
  webauthnRpName: Scalars['String']['input'];
  webauthnRpOrigins?: InputMaybe<Array<Scalars['String']['input']>>;
}

export interface EmailCodeAuthnConfigurationInput {
  enabled: Scalars['Boolean']['input'];
  smtpHost?: InputMaybe<Scalars['String']['input']>;
  smtpPort: Scalars['String']['input'];
  smtpFrom?: InputMaybe<Scalars['String']['input']>;
  smtpUsername?: InputMaybe<Scalars['String']['input']>;
  smtpPassword?: InputMaybe<Scalars['String']['input']>;
}

export interface McpConfigurationInput {
  enabled: Scalars['Boolean']['input'];
  dynamicRedirectHosts?: InputMaybe<Array<Scalars['String']['input']>>;
}

export interface SecurityConfigurationInput {
  trustedProxyCidrs: Array<Scalars['String']['input']>;
}

export interface AuthorizationConfigurationInput {
  masterPassword?: InputMaybe<Scalars['String']['input']>;
  disableAllAuth: Scalars['Boolean']['input'];
  oauthIssuerUrl: Scalars['String']['input'];
  frontendRedirectUris: Array<Scalars['String']['input']>;
  accessTokenLifetime: Scalars['String']['input'];
  refreshTokenLifetime: Scalars['String']['input'];
  devCorsAllowedOrigins?: InputMaybe<Array<Scalars['String']['input']>>;
}

export interface LocaleConfigurationInput {
  timezone: Scalars['String']['input'];
}

export interface GeneralConfigurationInput {
  disableTransactionTracking: Scalars['Boolean']['input'];
  disableWealthTracking: Scalars['Boolean']['input'];
  hideOwners: Scalars['Boolean']['input'];
}

export interface UpdateConfigurationInput {
  locale?: InputMaybe<LocaleConfigurationInput>;
  general?: InputMaybe<GeneralConfigurationInput>;
  authorization?: InputMaybe<AuthorizationConfigurationInput>;
  llmCategorization?: InputMaybe<LlmCategorizationConfigurationInput>;
  googleAuthn?: InputMaybe<GoogleAuthnConfigurationInput>;
  passKeyAuthn?: InputMaybe<PassKeyAuthnConfigurationInput>;
  emailCodeAuthn?: InputMaybe<EmailCodeAuthnConfigurationInput>;
  mcp?: InputMaybe<McpConfigurationInput>;
  security?: InputMaybe<SecurityConfigurationInput>;
  setupComplete?: InputMaybe<Scalars['Boolean']['input']>;
}

export interface UpdateConfigurationPayload {
  __typename?: 'UpdateConfigurationPayload';
  configuration: Configuration;
}

export interface Node {
  id: Scalars['ID']['output'];
}

export type Granularity =
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'YEARLY';

export interface PageInfo {
  __typename?: 'PageInfo';
  hasNextPage: Scalars['Boolean']['output'];
  hasPreviousPage: Scalars['Boolean']['output'];
  startCursor?: Maybe<Scalars['String']['output']>;
  endCursor?: Maybe<Scalars['String']['output']>;
}

export interface DateTimeRange {
  /** Inclusive lower bound as an ISO 8601 timestamp. */
  from?: InputMaybe<Scalars['DateTime']['input']>;
  /** Exclusive upper bound as an ISO 8601 timestamp. */
  to?: InputMaybe<Scalars['DateTime']['input']>;
}

export interface Query {
  __typename?: 'Query';
  /** All linked accounts. */
  accounts: AccountList;
  /** Single account by ID, with latest snapshot and manual liabilities. */
  account: Account;
  /** All household owners. Use for dropdowns when assigning items and accounts. */
  owners: OwnerList;
  /** All Plaid items (institutions), including soft-deleted if specified. */
  plaidItems: PlaidItemList;
  /** All data provider connections, including inactive if specified. */
  connections: ConnectionList;
  /** All EVM chains supported by the wallet balance provider. */
  evmChains: EVMChainList;
  /** All SimpleFIN access tokens. */
  simpleFinAccessTokens: SimpleFinAccessTokenList;
  /** All authorized users. Admin only. */
  users: UserList;
  /** All Plaid API credentials for settings management. Secrets are never returned. */
  plaidCredentials: PlaidCredentialList;
  /** Resolved server configuration. Admin only. */
  configuration: Configuration;
  /** General feature visibility configuration. Readable by any authenticated user. */
  generalConfiguration: GeneralConfiguration;
  /** The instance timezone (IANA). Readable by any authenticated user. */
  instanceTimezone: Scalars['String']['output'];
  node?: Maybe<Node>;
  nodes?: Maybe<Array<Maybe<Node>>>;
  /** Aggregate budget totals for months with budget history. */
  budgetReportHistory: BudgetReportHistory;
  /** Budget report for a month, grouped by category group with actual-vs-budgeted lines. */
  budgetReport: BudgetReport;
  /** Portfolio allocation analysis across multiple views. */
  analysis: AnalysisReport;
  /** Paginated transaction list with filtering and sorting. */
  transactions: TransactionConnection;
  /** Single transaction by ID. */
  transaction?: Maybe<Transaction>;
  /** Aggregate statistics for a filtered set of transactions. */
  transactionsSummary: TransactionsSummary;
  /** Number of transactions awaiting background LLM categorization. */
  transactionsStagedForCategorization: TransactionsStagedForCategorization;
  /** Detected recurring charges grouped by merchant. */
  recurringCharges: RecurringChargeList;
  /** All categories. */
  categories: CategoryList;
  /** Categories organized by group (for filter UI / sidebar). */
  categoryGroups: CategoryGroupList;
  /** All valid Plaid PFC2 detailed category codes. */
  plaidPFC2Codes: Array<Scalars['String']['output']>;
  tags: TagList;
  /** All rules, ordered by priority desc. */
  rules: RuleList;
  /** Combined spending report grouped by category for a date range. */
  spendingByCategory: SpendingByCategoryReport;
  /**
   * Cash flow data: income and expense breakdowns by category per period,
   * with summary totals (income, expenses, savings, savings rate).
   * Excludes transfers but includes income.
   */
  cashFlow: CashFlowReport;
  /** Current household net worth snapshot with breakdowns. Closed accounts are excluded. */
  netWorth: NetWorthReport;
  /** Historical net worth and per-classifier allocation series. Closed accounts contribute only through their closure date. */
  historicalNetWorth: HistoricalNetWorthReport;
  /** Live price quote for a security ticker. */
  assetQuote: AssetQuote;
  /** Assets with optional connectivity-status and text-search filtering. */
  assets: AssetList;
  /** Pending balance snapshot reviews. */
  balanceSnapshotReviews: BalanceSnapshotReviewList;
  /** Read one balance snapshot by ID, or by account and optional local date. */
  accountSnapshot?: Maybe<AccountSnapshot>;
  /** Paginated account snapshots, newest first, one per local day. */
  accountSnapshots: AccountSnapshotConnection;
}


export interface QueryaccountArgs {
  id: Scalars['ID']['input'];
}


export interface QueryplaidItemsArgs {
  input?: InputMaybe<PlaidItemsInput>;
}


export interface QueryconnectionsArgs {
  input?: InputMaybe<ConnectionsInput>;
}


export interface QuerynodeArgs {
  id: Scalars['ID']['input'];
}


export interface QuerynodesArgs {
  ids: Array<Scalars['ID']['input']>;
}


export interface QuerybudgetReportHistoryArgs {
  input?: InputMaybe<BudgetReportHistoryInput>;
}


export interface QuerybudgetReportArgs {
  input: BudgetReportInput;
}


export interface QueryanalysisArgs {
  input: AnalysisInput;
}


export interface QuerytransactionsArgs {
  input?: InputMaybe<TransactionsInput>;
}


export interface QuerytransactionArgs {
  id: Scalars['ID']['input'];
}


export interface QuerytransactionsSummaryArgs {
  filter?: InputMaybe<TransactionsFilter>;
}


export interface QueryrulesArgs {
  input?: InputMaybe<RulesInput>;
}


export interface QueryspendingByCategoryArgs {
  filter: SpendingFilter;
}


export interface QuerycashFlowArgs {
  filter: SpendingFilter;
}


export interface QuerynetWorthArgs {
  input: NetWorthInput;
}


export interface QueryhistoricalNetWorthArgs {
  input: HistoricalNetWorthInput;
}


export interface QueryassetQuoteArgs {
  ticker: Scalars['String']['input'];
}


export interface QueryassetsArgs {
  input?: InputMaybe<AssetsInput>;
}


export interface QueryaccountSnapshotArgs {
  input: AccountSnapshotInput;
}


export interface QueryaccountSnapshotsArgs {
  input: AccountSnapshotsInput;
}

export interface Mutation {
  __typename?: 'Mutation';
  createOwner: Owner;
  /** Delete a household owner by ID. Fails if accounts or items still reference it. */
  deleteOwner: Scalars['Boolean']['output'];
  createManualAccount: CreateManualAccountPayload;
  updateAccount: UpdateAccountPayload;
  removeManualAccount: RemoveManualAccountPayload;
  updateConnection: UpdateConnectionPayload;
  deleteConnection: DeleteConnectionPayload;
  /**
   * Link an EVM wallet address. Validates the address, creates the connection,
   * and triggers an initial balance sync in the background.
   */
  linkEVMWallet: LinkEVMWalletPayload;
  unlinkEVMWallet: Scalars['Boolean']['output'];
  /** Step 1 of Plaid Link: create a link_token for the frontend to initialize the Plaid Link UI. */
  createLinkToken: CreateLinkTokenPayload;
  /** Step 2 of Plaid Link: exchange the public_token returned by Plaid Link for an access_token. */
  exchangePublicToken: ExchangePublicTokenPayload;
  /** Create a link_token for Plaid Link update mode for an existing Item. */
  createUpdateLinkToken: CreateLinkTokenPayload;
  /** Called after the frontend receives Plaid Link update-mode onSuccess. Triggers an immediate sync. */
  completeLinkUpdate: CompleteLinkUpdatePayload;
  /** Claim a Setup Token, store the Access URL, create connections/accounts, trigger initial sync. */
  createSimpleFinAccessToken: CreateSimpleFinAccessTokenPayload;
  /** Delete a SimpleFIN Access Token and all its connections/accounts. */
  deleteSimpleFinAccessToken: Scalars['Boolean']['output'];
  /** Clear last_synced_at to force a full re-pull on the next background sync tick. */
  resetSimpleFinSync: SimpleFinAccessToken;
  /** Add a user. Admin only. Sends 24-hour invite link. */
  addUser: AddUserPayload;
  /** Generate a single-use, 15-minute sign-in + passkey-onboarding link for an existing user. */
  createInviteLink: CreateInviteLinkPayload;
  /** Remove a user and revoke all their tokens. Admin only. */
  removeUser: RemoveUserPayload;
  /** Update a user's role. Admin only. */
  updateUser: UpdateUserPayload;
  /** Store a Plaid API credential pair. Secrets are never returned. */
  createPlaidCredential: CreatePlaidCredentialPayload;
  /** Rotate a Plaid credential secret or environment. client_id is immutable. */
  updatePlaidCredential: UpdatePlaidCredentialPayload;
  /** Delete a Plaid credential. Fails while Plaid items still reference it. */
  deletePlaidCredential: DeletePlaidCredentialPayload;
  /** Update one or more runtime configuration sections. Omitted sections are left unchanged. */
  updateConfiguration: UpdateConfigurationPayload;
  setBudget: SetBudgetPayload;
  deleteBudget: DeleteBudgetPayload;
  /** Copy all category budgets from one month to another, skipping existing rows. */
  copyBudgets: CopyBudgetsPayload;
  createCategoryGroup: CreateCategoryGroupPayload;
  updateCategoryGroup: UpdateCategoryGroupPayload;
  deleteCategoryGroup: DeleteCategoryGroupPayload;
  createCategory: CreateCategoryPayload;
  updateCategory: UpdateCategoryPayload;
  deleteCategory: DeleteCategoryPayload;
  reorderCategories: ReorderCategoriesPayload;
  createTag: CreateTagPayload;
  updateTag: UpdateTagPayload;
  deleteTag: DeleteTagPayload;
  /**
   * Create an auto-categorization rule.
   * If applyRetroactively is true, all existing matching transactions are updated.
   */
  createRule: CreateRulePayload;
  updateRule: UpdateRulePayload;
  deleteRule: DeleteRulePayload;
  createTransaction: CreateTransactionPayload;
  /** Edit transaction metadata (notes, recurring flag, etc.). */
  updateTransaction: UpdateTransactionPayload;
  deleteTransaction: DeleteTransactionPayload;
  /** Batch-update transaction metadata for selected transactions. */
  bulkUpdateTransactions: BulkUpdateTransactionsPayload;
  /** Permanently delete transactions. Exactly one of transactionIds or filter is required. */
  bulkDeleteTransactions: BulkDeleteTransactionsPayload;
  /**
   * Stage every unreviewed transaction for LLM categorization and wake the
   * background worker. Fails if LLM categorization is not enabled.
   */
  reprocessUncategorizedTransactions: ReprocessUncategorizedTransactionsPayload;
  /** Create a user-managed asset catalog row. */
  createAsset: CreateAssetPayload;
  /** Edit an asset's shared fields and type-specific details. */
  updateAsset: UpdateAssetPayload;
  mergeAsset: MergeAssetPayload;
  linkRealEstate: LinkRealEstatePayload;
  updateRealEstate: UpdateRealEstatePayload;
  unlinkRealEstate: Scalars['Boolean']['output'];
  resolveBalanceReview: ResolveBalanceReviewPayload;
  /** Overwrite a snapshot's balance and holdings in place. */
  changeAccountSnapshot: ChangeAccountSnapshotPayload;
}


export interface MutationcreateOwnerArgs {
  input: CreateOwnerInput;
}


export interface MutationdeleteOwnerArgs {
  id: Scalars['ID']['input'];
}


export interface MutationcreateManualAccountArgs {
  input: CreateManualAccountInput;
}


export interface MutationupdateAccountArgs {
  input: UpdateAccountInput;
}


export interface MutationremoveManualAccountArgs {
  input: RemoveManualAccountInput;
}


export interface MutationupdateConnectionArgs {
  input: UpdateConnectionInput;
}


export interface MutationdeleteConnectionArgs {
  input: DeleteConnectionInput;
}


export interface MutationlinkEVMWalletArgs {
  input: LinkEVMWalletInput;
}


export interface MutationunlinkEVMWalletArgs {
  id: Scalars['ID']['input'];
}


export interface MutationcreateLinkTokenArgs {
  input: CreateLinkTokenInput;
}


export interface MutationexchangePublicTokenArgs {
  input: ExchangePublicTokenInput;
}


export interface MutationcreateUpdateLinkTokenArgs {
  itemId: Scalars['ID']['input'];
}


export interface MutationcompleteLinkUpdateArgs {
  itemId: Scalars['ID']['input'];
}


export interface MutationcreateSimpleFinAccessTokenArgs {
  input: CreateSimpleFinAccessTokenInput;
}


export interface MutationdeleteSimpleFinAccessTokenArgs {
  id: Scalars['ID']['input'];
}


export interface MutationresetSimpleFinSyncArgs {
  id: Scalars['ID']['input'];
}


export interface MutationaddUserArgs {
  input: AddUserInput;
}


export interface MutationcreateInviteLinkArgs {
  input: CreateInviteLinkInput;
}


export interface MutationremoveUserArgs {
  input: RemoveUserInput;
}


export interface MutationupdateUserArgs {
  input: UpdateUserInput;
}


export interface MutationcreatePlaidCredentialArgs {
  input: CreatePlaidCredentialInput;
}


export interface MutationupdatePlaidCredentialArgs {
  input: UpdatePlaidCredentialInput;
}


export interface MutationdeletePlaidCredentialArgs {
  input: DeletePlaidCredentialInput;
}


export interface MutationupdateConfigurationArgs {
  input: UpdateConfigurationInput;
}


export interface MutationsetBudgetArgs {
  input: SetBudgetInput;
}


export interface MutationdeleteBudgetArgs {
  input: DeleteBudgetInput;
}


export interface MutationcopyBudgetsArgs {
  input: CopyBudgetsInput;
}


export interface MutationcreateCategoryGroupArgs {
  input: CreateCategoryGroupInput;
}


export interface MutationupdateCategoryGroupArgs {
  input: UpdateCategoryGroupInput;
}


export interface MutationdeleteCategoryGroupArgs {
  id: Scalars['ID']['input'];
}


export interface MutationcreateCategoryArgs {
  input: CreateCategoryInput;
}


export interface MutationupdateCategoryArgs {
  input: UpdateCategoryInput;
}


export interface MutationdeleteCategoryArgs {
  id: Scalars['ID']['input'];
}


export interface MutationreorderCategoriesArgs {
  input: ReorderCategoriesInput;
}


export interface MutationcreateTagArgs {
  input: CreateTagInput;
}


export interface MutationupdateTagArgs {
  input: UpdateTagInput;
}


export interface MutationdeleteTagArgs {
  id: Scalars['ID']['input'];
}


export interface MutationcreateRuleArgs {
  input: CreateRuleInput;
}


export interface MutationupdateRuleArgs {
  input: UpdateRuleInput;
}


export interface MutationdeleteRuleArgs {
  id: Scalars['ID']['input'];
}


export interface MutationcreateTransactionArgs {
  input: CreateTransactionInput;
}


export interface MutationupdateTransactionArgs {
  input: UpdateTransactionInput;
}


export interface MutationdeleteTransactionArgs {
  id: Scalars['ID']['input'];
}


export interface MutationbulkUpdateTransactionsArgs {
  input: BulkUpdateTransactionsInput;
}


export interface MutationbulkDeleteTransactionsArgs {
  input: BulkDeleteTransactionsInput;
}


export interface MutationcreateAssetArgs {
  input: CreateAssetInput;
}


export interface MutationupdateAssetArgs {
  input: UpdateAssetInput;
}


export interface MutationmergeAssetArgs {
  input: MergeAssetInput;
}


export interface MutationlinkRealEstateArgs {
  input: LinkRealEstateInput;
}


export interface MutationupdateRealEstateArgs {
  input: UpdateRealEstateInput;
}


export interface MutationunlinkRealEstateArgs {
  id: Scalars['ID']['input'];
}


export interface MutationresolveBalanceReviewArgs {
  input: ResolveBalanceReviewInput;
}


export interface MutationchangeAccountSnapshotArgs {
  input: ChangeAccountSnapshotInput;
}

/** A single per-category budget target for a given month. */
export interface Budget extends Node {
  __typename?: 'Budget';
  id: Scalars['ID']['output'];
  month: Scalars['String']['output'];
  category: Category;
  amount: Scalars['Money']['output'];
}

/** A budget line for one category — budgeted vs actual for the month. */
export interface BudgetLine {
  __typename?: 'BudgetLine';
  /** The budget row ID; null when only actuals exist (no budget target set). */
  id?: Maybe<Scalars['ID']['output']>;
  category: Category;
  budgeted: Scalars['Money']['output'];
  actual: Scalars['Money']['output'];
  remaining: Scalars['Money']['output'];
}

/** A budget section grouped by category group. */
export interface BudgetSection {
  __typename?: 'BudgetSection';
  label: Scalars['String']['output'];
  group: CategoryGroup;
  budgeted: Scalars['Money']['output'];
  actual: Scalars['Money']['output'];
  remaining: Scalars['Money']['output'];
  lines: Array<BudgetLine>;
}

/** Budget report for a single month with section-level rollups. */
export interface BudgetReport {
  __typename?: 'BudgetReport';
  month: Scalars['String']['output'];
  expensesBudgeted: Scalars['Money']['output'];
  expensesActual: Scalars['Money']['output'];
  incomeBudgeted: Scalars['Money']['output'];
  incomeActual: Scalars['Money']['output'];
  remainingBudgeted: Scalars['Money']['output'];
  remainingActual: Scalars['Money']['output'];
  sections: Array<BudgetSection>;
}

/** Budget report history, ordered by month descending. */
export interface BudgetReportHistory {
  __typename?: 'BudgetReportHistory';
  items: Array<BudgetReport>;
}

export interface BudgetReportInput {
  /** Month in YYYY-MM format. */
  month: Scalars['String']['input'];
}

export interface BudgetReportHistoryInput {
  /** Start month in YYYY-MM format, inclusive. */
  startMonth?: InputMaybe<Scalars['String']['input']>;
  /** End month in YYYY-MM format, exclusive. */
  endMonth?: InputMaybe<Scalars['String']['input']>;
}

export interface SetBudgetInput {
  month: Scalars['String']['input'];
  categoryId: Scalars['ID']['input'];
  amount: Scalars['Money']['input'];
}

export interface SetBudgetPayload {
  __typename?: 'SetBudgetPayload';
  budget: Budget;
}

export interface DeleteBudgetInput {
  id: Scalars['ID']['input'];
}

export interface DeleteBudgetPayload {
  __typename?: 'DeleteBudgetPayload';
  success: Scalars['Boolean']['output'];
}

export interface CopyBudgetsInput {
  fromMonth: Scalars['String']['input'];
  toMonth: Scalars['String']['input'];
}

export interface CopyBudgetsPayload {
  __typename?: 'CopyBudgetsPayload';
  copiedCount: Scalars['Int']['output'];
}

export type AnalysisView =
  | 'COMPOSITION'
  | 'MORNINGSTAR_CATEGORY'
  | 'MORNINGSTAR_GROUP'
  | 'SECTORS';

export interface AnalysisInput {
  view: AnalysisView;
  ownerIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  accountSubtypes?: InputMaybe<Array<Scalars['String']['input']>>;
  accountIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  includeUnclassified?: InputMaybe<Scalars['Boolean']['input']>;
}

/** One segment of an analysis breakdown, e.g. 'US Equity' or 'Technology'. */
export interface AnalysisSlice {
  __typename?: 'AnalysisSlice';
  /** Human-readable label for this segment. */
  label: Scalars['String']['output'];
  /** Total USD value attributed to this segment. */
  valueUSD: Scalars['Money']['output'];
  /** Percentage of the total analyzed portfolio (0-100). */
  percent: Scalars['Float']['output'];
  /** Individual holdings that contribute to this segment. */
  holdings: Array<AnalysisHolding>;
}

/** A single holding's contribution to an analysis slice. */
export interface AnalysisHolding {
  __typename?: 'AnalysisHolding';
  asset: Asset;
  /** USD value this holding contributes to the parent slice. */
  valueUSD: Scalars['Money']['output'];
  /** Percentage of the parent slice's total value (0-100). */
  percent: Scalars['Float']['output'];
}

/** Result of the analysis query: a full breakdown for a single view. */
export interface AnalysisReport {
  __typename?: 'AnalysisReport';
  view: AnalysisView;
  /** Total USD value of all analyzed PUBLIC holdings before slicing. */
  totalValueUSD: Scalars['Money']['output'];
  /** Breakdown segments, sorted descending by valueUSD. */
  slices: Array<AnalysisSlice>;
}

export type CategoryKind =
  | 'EXPENSE'
  | 'INCOME'
  | 'TRANSFER';

export type TransactionSortField =
  | 'DATE'
  | 'AMOUNT';

export type SortDirection =
  | 'ASC'
  | 'DESC';

export type RecurrenceInterval =
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'YEARLY';

export type RecurringStreamStatus =
  | 'MATURE'
  | 'EARLY_DETECTION'
  | 'TOMBSTONED'
  | 'UNKNOWN';

export interface Category extends Node {
  __typename?: 'Category';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  emoji: Scalars['String']['output'];
  groupName: Scalars['String']['output'];
  groupEmoji: Scalars['String']['output'];
  kind: CategoryKind;
  sortOrder: Scalars['Int']['output'];
  plaidPFC2Codes: Array<Scalars['String']['output']>;
}

export interface CategoryGroup extends Node {
  __typename?: 'CategoryGroup';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  emoji: Scalars['String']['output'];
  kind: CategoryKind;
  categories: Array<Category>;
}

export interface CategoryList {
  __typename?: 'CategoryList';
  items: Array<Category>;
}

export interface CategoryGroupList {
  __typename?: 'CategoryGroupList';
  items: Array<CategoryGroup>;
}

export interface Tag extends Node {
  __typename?: 'Tag';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  color: Scalars['String']['output'];
  transactionCount: Scalars['Int']['output'];
}

export interface TagList {
  __typename?: 'TagList';
  items: Array<Tag>;
}

export interface Transaction extends Node {
  __typename?: 'Transaction';
  id: Scalars['ID']['output'];
  account: Account;
  amount: Scalars['Money']['output'];
  /** ISO 8601 datetime when the transaction was authorized (YYYY-MM-DDTHH:mm:ssZ). */
  datetime: Scalars['DateTime']['output'];
  /** ISO 8601 datetime when the transaction posted/settled (YYYY-MM-DDTHH:mm:ssZ). */
  postedDatetime: Scalars['DateTime']['output'];
  merchantName?: Maybe<Scalars['String']['output']>;
  originalName?: Maybe<Scalars['String']['output']>;
  /** Merchant logo URL sourced from Plaid. Null when unavailable. */
  logoUrl?: Maybe<Scalars['String']['output']>;
  /** Always present — uncategorized transactions use the sentinel category (id 0). */
  category: Category;
  isRecurring: Scalars['Boolean']['output'];
  isReviewed: Scalars['Boolean']['output'];
  notes?: Maybe<Scalars['String']['output']>;
  plaidCategory?: Maybe<Scalars['String']['output']>;
  pending: Scalars['Boolean']['output'];
  isHidden: Scalars['Boolean']['output'];
  createdAt: Scalars['DateTime']['output'];
  updatedAt: Scalars['DateTime']['output'];
  tags: Array<Tag>;
}

export interface TransactionConnection {
  __typename?: 'TransactionConnection';
  edges: Array<TransactionEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
}

export interface TransactionEdge {
  __typename?: 'TransactionEdge';
  node: Transaction;
  cursor: Scalars['String']['output'];
}

/** Aggregate statistics for a filtered set of transactions. */
export interface TransactionsSummary {
  __typename?: 'TransactionsSummary';
  totalCount: Scalars['Int']['output'];
  totalAmount: Scalars['Money']['output'];
  averageAmount: Scalars['Money']['output'];
  largestAmount: Scalars['Money']['output'];
  /** Date of the earliest matching transaction. */
  firstDate?: Maybe<Scalars['Date']['output']>;
  /** Date of the most recent matching transaction. */
  lastDate?: Maybe<Scalars['Date']['output']>;
}

export interface TransactionsStagedForCategorization {
  __typename?: 'TransactionsStagedForCategorization';
  count: Scalars['Int']['output'];
}

/** A recurring transaction stream sourced from Plaid's /transactions/recurring/get. */
export interface RecurringCharge extends Node {
  __typename?: 'RecurringCharge';
  id: Scalars['ID']['output'];
  merchantName: Scalars['String']['output'];
  estimatedAmount: Scalars['Money']['output'];
  interval?: Maybe<RecurrenceInterval>;
  category?: Maybe<Category>;
  transactions: Array<Transaction>;
  firstDate: Scalars['Date']['output'];
  lastDate: Scalars['Date']['output'];
  lastAmount: Scalars['Money']['output'];
  isUserModified: Scalars['Boolean']['output'];
  /** Computed from lastDate + interval. Null if interval is unknown. */
  nextExpectedDate?: Maybe<Scalars['Date']['output']>;
  status: RecurringStreamStatus;
  isActive: Scalars['Boolean']['output'];
}

export interface RecurringChargeList {
  __typename?: 'RecurringChargeList';
  items: Array<RecurringCharge>;
}

/** Aggregate spending stats for a single time bucket. */
export interface SpendingAggregatePeriod {
  __typename?: 'SpendingAggregatePeriod';
  periodLabel: Scalars['String']['output'];
  periodStart: Scalars['Date']['output'];
  periodEnd: Scalars['Date']['output'];
  totalAmount: Scalars['Money']['output'];
  transactionCount: Scalars['Int']['output'];
}

/** Aggregate spending stats for a category within a single time bucket. */
export interface CategorySpendingPeriod {
  __typename?: 'CategorySpendingPeriod';
  periodLabel: Scalars['String']['output'];
  periodStart: Scalars['Date']['output'];
  periodEnd: Scalars['Date']['output'];
  totalAmount: Scalars['Money']['output'];
  transactionCount: Scalars['Int']['output'];
  percentOfTotal: Scalars['Float']['output'];
}

/** Aggregate spending stats for a single category. */
export interface CategorySpendingAggregate {
  __typename?: 'CategorySpendingAggregate';
  category: Category;
  totalAmount: Scalars['Money']['output'];
  transactionCount: Scalars['Int']['output'];
  percentOfTotal: Scalars['Float']['output'];
  periods: Array<CategorySpendingPeriod>;
}

/** Combined spending report for totals, periods, and categories. */
export interface SpendingByCategoryReport {
  __typename?: 'SpendingByCategoryReport';
  totalAmount: Scalars['Money']['output'];
  transactionCount: Scalars['Int']['output'];
  periods: Array<SpendingAggregatePeriod>;
  categories: Array<CategorySpendingAggregate>;
}

/** Aggregate income, expenses, savings, and savings rate for a period. */
export interface CashFlowSummary {
  __typename?: 'CashFlowSummary';
  /** Total income (sum of transactions in income categories). */
  income: Scalars['Money']['output'];
  /** Total expenses (sum of transactions in non-income, non-transfer categories). */
  expenses: Scalars['Money']['output'];
  savings: Scalars['Money']['output'];
  /** Savings / income as a percentage (0–100). 0 if income is zero. */
  savingsRate: Scalars['Float']['output'];
}

/** Spending or income total for a single category within a cash flow period. */
export interface CashFlowBreakdown {
  __typename?: 'CashFlowBreakdown';
  category: Category;
  total: Scalars['Money']['output'];
  transactionCount: Scalars['Int']['output'];
  percentOfTotal: Scalars['Float']['output'];
}

/** Cash flow data for a single time bucket (month, quarter, or year). */
export interface CashFlowPeriod {
  __typename?: 'CashFlowPeriod';
  periodLabel: Scalars['String']['output'];
  periodStart: Scalars['Date']['output'];
  periodEnd: Scalars['Date']['output'];
  summary: CashFlowSummary;
  /** Income categories with their totals, sorted by total descending. */
  incomeByCategory: Array<CashFlowBreakdown>;
  /** Expense categories with their totals, sorted by total descending. */
  expensesByCategory: Array<CashFlowBreakdown>;
}

/** Envelope type for the cashFlow query. */
export interface CashFlowReport {
  __typename?: 'CashFlowReport';
  periods: Array<CashFlowPeriod>;
}

export interface Rule extends Node {
  __typename?: 'Rule';
  id: Scalars['ID']['output'];
  merchantPattern?: Maybe<Scalars['String']['output']>;
  originalPattern?: Maybe<Scalars['String']['output']>;
  merchantName?: Maybe<Scalars['String']['output']>;
  category?: Maybe<Category>;
  tags?: Maybe<Array<Tag>>;
  shouldHide?: Maybe<Scalars['Boolean']['output']>;
  shouldBeRecurring?: Maybe<Scalars['Boolean']['output']>;
  accounts?: Maybe<Array<Account>>;
  amountMin?: Maybe<Scalars['Money']['output']>;
  amountMax?: Maybe<Scalars['Money']['output']>;
  priority: Scalars['Int']['output'];
  createdAt: Scalars['DateTime']['output'];
}

export interface RuleList {
  __typename?: 'RuleList';
  items: Array<Rule>;
}

export interface TransactionsFilter {
  datetimeRange?: InputMaybe<DateTimeRange>;
  categoryIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  accountIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  ownerIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  isReviewed?: InputMaybe<Scalars['Boolean']['input']>;
  isRecurring?: InputMaybe<Scalars['Boolean']['input']>;
  isPending?: InputMaybe<Scalars['Boolean']['input']>;
  isHidden?: InputMaybe<Scalars['Boolean']['input']>;
  merchantPrefix?: InputMaybe<Scalars['String']['input']>;
  originalPrefix?: InputMaybe<Scalars['String']['input']>;
  excludeTransfers?: InputMaybe<Scalars['Boolean']['input']>;
  excludeIncome?: InputMaybe<Scalars['Boolean']['input']>;
  amountMin?: InputMaybe<Scalars['Money']['input']>;
  amountMax?: InputMaybe<Scalars['Money']['input']>;
  exactAmount?: InputMaybe<Scalars['Money']['input']>;
  tagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  untagged?: InputMaybe<Scalars['Boolean']['input']>;
  /** Full-text query matched against merchant name, original name, and notes. */
  search?: InputMaybe<Scalars['String']['input']>;
}

export interface TransactionSort {
  field: TransactionSortField;
  direction: SortDirection;
}

export interface TransactionsInput {
  filter?: InputMaybe<TransactionsFilter>;
  sort?: InputMaybe<TransactionSort>;
  first?: InputMaybe<Scalars['Int']['input']>;
  after?: InputMaybe<Scalars['String']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
}

export interface RulesInput {
  merchantPattern?: InputMaybe<Scalars['String']['input']>;
  originalPattern?: InputMaybe<Scalars['String']['input']>;
  accountIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  amountMin?: InputMaybe<Scalars['Money']['input']>;
  amountMax?: InputMaybe<Scalars['Money']['input']>;
}

export interface SpendingFilter {
  datetimeRange: DateTimeRange;
  /** Optional for spendingByCategory; required by bucketed reports when period granularity matters. */
  granularity?: InputMaybe<Granularity>;
  categoryIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  ownerIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  accountIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  isHidden?: InputMaybe<Scalars['Boolean']['input']>;
  tagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  untagged?: InputMaybe<Scalars['Boolean']['input']>;
}

export interface CreateCategoryGroupInput {
  name: Scalars['String']['input'];
  emoji: Scalars['String']['input'];
  kind: CategoryKind;
}

export interface CreateCategoryGroupPayload {
  __typename?: 'CreateCategoryGroupPayload';
  group: CategoryGroup;
}

export interface UpdateCategoryGroupInput {
  id: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  emoji: Scalars['String']['input'];
}

export interface UpdateCategoryGroupPayload {
  __typename?: 'UpdateCategoryGroupPayload';
  group: CategoryGroup;
}

export interface DeleteCategoryGroupPayload {
  __typename?: 'DeleteCategoryGroupPayload';
  success: Scalars['Boolean']['output'];
}

export interface CreateCategoryInput {
  name: Scalars['String']['input'];
  emoji: Scalars['String']['input'];
  groupId: Scalars['ID']['input'];
}

export interface CreateCategoryPayload {
  __typename?: 'CreateCategoryPayload';
  category: Category;
}

export interface UpdateCategoryInput {
  id: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  emoji: Scalars['String']['input'];
  groupId: Scalars['ID']['input'];
  plaidPFC2Codes?: InputMaybe<Array<Scalars['String']['input']>>;
}

export interface UpdateCategoryPayload {
  __typename?: 'UpdateCategoryPayload';
  category: Category;
}

export interface DeleteCategoryPayload {
  __typename?: 'DeleteCategoryPayload';
  success: Scalars['Boolean']['output'];
}

export interface CreateTagInput {
  name: Scalars['String']['input'];
  color: Scalars['String']['input'];
}

export interface CreateTagPayload {
  __typename?: 'CreateTagPayload';
  tag: Tag;
}

export interface UpdateTagInput {
  id: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  color: Scalars['String']['input'];
}

export interface UpdateTagPayload {
  __typename?: 'UpdateTagPayload';
  tag: Tag;
}

export interface DeleteTagPayload {
  __typename?: 'DeleteTagPayload';
  success: Scalars['Boolean']['output'];
}

export interface ReorderCategoriesInput {
  groupId: Scalars['ID']['input'];
  /** Full ordered list of category IDs; backend assigns sort_order 1..N. */
  categoryIds: Array<Scalars['ID']['input']>;
}

export interface ReorderCategoriesPayload {
  __typename?: 'ReorderCategoriesPayload';
  group: CategoryGroup;
}

export interface CreateRuleInput {
  merchantPattern?: InputMaybe<Scalars['String']['input']>;
  originalPattern?: InputMaybe<Scalars['String']['input']>;
  changes: TransactionUpdates;
  accountIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  amountMin?: InputMaybe<Scalars['Money']['input']>;
  amountMax?: InputMaybe<Scalars['Money']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  applyRetroactively?: InputMaybe<Scalars['Boolean']['input']>;
}

export interface CreateRulePayload {
  __typename?: 'CreateRulePayload';
  rule: Rule;
  retroactivelyUpdated: Scalars['Int']['output'];
}

export interface UpdateRuleInput {
  id: Scalars['ID']['input'];
  merchantPattern?: InputMaybe<Scalars['String']['input']>;
  originalPattern?: InputMaybe<Scalars['String']['input']>;
  changes: TransactionUpdates;
  accountIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  amountMin?: InputMaybe<Scalars['Money']['input']>;
  amountMax?: InputMaybe<Scalars['Money']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  applyRetroactively?: InputMaybe<Scalars['Boolean']['input']>;
}

export interface UpdateRulePayload {
  __typename?: 'UpdateRulePayload';
  rule: Rule;
  retroactivelyUpdated: Scalars['Int']['output'];
}

export interface DeleteRulePayload {
  __typename?: 'DeleteRulePayload';
  success: Scalars['Boolean']['output'];
}

export interface CreateTransactionInput {
  accountId: Scalars['ID']['input'];
  date: Scalars['Date']['input'];
  amount: Scalars['Money']['input'];
  merchantName?: InputMaybe<Scalars['String']['input']>;
  originalName?: InputMaybe<Scalars['String']['input']>;
  categoryId?: InputMaybe<Scalars['ID']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  isRecurring?: InputMaybe<Scalars['Boolean']['input']>;
  isHidden?: InputMaybe<Scalars['Boolean']['input']>;
}

export interface CreateTransactionPayload {
  __typename?: 'CreateTransactionPayload';
  transaction: Transaction;
}

export interface TransactionUpdates {
  merchantName?: InputMaybe<Scalars['String']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  isRecurring?: InputMaybe<Scalars['Boolean']['input']>;
  isHidden?: InputMaybe<Scalars['Boolean']['input']>;
  categoryId?: InputMaybe<Scalars['ID']['input']>;
  tagIds?: InputMaybe<Array<Scalars['ID']['input']>>;
}

export interface UpdateTransactionInput {
  id: Scalars['ID']['input'];
  updates: TransactionUpdates;
}

export interface UpdateTransactionPayload {
  __typename?: 'UpdateTransactionPayload';
  transaction: Transaction;
}

export interface DeleteTransactionPayload {
  __typename?: 'DeleteTransactionPayload';
  success: Scalars['Boolean']['output'];
}

export interface BulkUpdateTransactionsInput {
  /** Exactly one of transactionIds or filter must be supplied. */
  transactionIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  filter?: InputMaybe<TransactionsFilter>;
  updates: TransactionUpdates;
}

export interface BulkUpdateTransactionsPayload {
  __typename?: 'BulkUpdateTransactionsPayload';
  updatedCount: Scalars['Int']['output'];
  transactions: Array<Transaction>;
}

export interface BulkDeleteTransactionsInput {
  /** Exactly one of transactionIds or filter must be supplied. */
  transactionIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  filter?: InputMaybe<TransactionsFilter>;
}

export interface BulkDeleteTransactionsPayload {
  __typename?: 'BulkDeleteTransactionsPayload';
  deletedCount: Scalars['Int']['output'];
}

export interface ReprocessUncategorizedTransactionsPayload {
  __typename?: 'ReprocessUncategorizedTransactionsPayload';
  stagedCount: Scalars['Int']['output'];
}

export type AssetClassifier =
  | 'CASH'
  | 'PUBLIC'
  | 'COMPANY_EQUITY'
  | 'CRYPTOCURRENCY'
  | 'STABLECOIN'
  | 'REAL_ESTATE';

export type AssetType =
  | 'CURRENCY'
  | 'SECURITY'
  | 'CRYPTO'
  | 'REAL_ESTATE'
  | 'OTHER';

export type AssetSourceAdapter =
  | 'PLAID'
  | 'SIMPLEFIN'
  | 'DEBANK';

export type NetWorthRange =
  | 'ONE_MONTH'
  | 'THREE_MONTH'
  | 'YTD'
  | 'ONE_YEAR'
  | 'ALL';

export type ConnectivityStatus =
  | 'HEALTHY'
  | 'NOT_FOUND'
  | 'IGNORE';

export type BalanceReviewDecision =
  | 'IN_REVIEW'
  | 'APPROVED_CHANGES';

export type BalanceReviewAction =
  | 'APPROVE_CHANGES'
  | 'USE_PROVIDER';

export type LiabilityCategory =
  | 'CARD'
  | 'MORTGAGE'
  | 'LOAN'
  | 'OTHER';

export interface Address {
  __typename?: 'Address';
  street?: Maybe<Scalars['String']['output']>;
  city?: Maybe<Scalars['String']['output']>;
  state?: Maybe<Scalars['String']['output']>;
  zip?: Maybe<Scalars['String']['output']>;
  homeType?: Maybe<Scalars['String']['output']>;
}

/** Type-specific details for a real-estate asset. */
export interface RealEstateAssetDetails {
  __typename?: 'RealEstateAssetDetails';
  address: Address;
}

/**
 * Discriminated union of type-specific asset details.
 * The `assetType` field on the parent `Asset` determines which variant is returned,
 * or null when the asset has no side-table (e.g. CURRENCY).
 */
export type AssetDetails = RealEstateAssetDetails;

/** Wealth-owned property details exposed on account records. */
export type AccountWealthProperty = RealEstateAssetDetails;

export interface Asset extends Node {
  __typename?: 'Asset';
  id: Scalars['ID']['output'];
  assetType: AssetType;
  identifier: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  classifier: AssetClassifier;
  currentPrice?: Maybe<Scalars['Float']['output']>;
  details?: Maybe<AssetDetails>;
  /** Fixed USD price per unit, overriding live price. May be negative for contra-assets. */
  forcedUsdPrice?: Maybe<Scalars['Float']['output']>;
  /** Ticker used for Yahoo price lookups. Falls back to identifier when null. */
  trackingTicker?: Maybe<Scalars['String']['output']>;
  /** Multiplier applied to the tracking ticker's price. Default 1. */
  trackingMultiplier: Scalars['Float']['output'];
  priceConnectivity: ConnectivityStatus;
  /** Provider-side IDs this asset is tracked by, across all integrations. */
  adapterSources: Array<AssetAdapterSource>;
  /** Computed current position across accounts. Null when the asset is not held. */
  latestSnapshot?: Maybe<AssetSnapshot>;
  investmentConnectivity: ConnectivityStatus;
}

/** Computed current-position projection for one asset. Not persisted; no Node ID. */
export interface AssetSnapshot {
  __typename?: 'AssetSnapshot';
  /** Latest contributing account snapshot date; older accounts carry forward. */
  asOfDate: Scalars['Date']['output'];
  /** Null when any contributing provider supplies valuation without quantity. */
  totalHeldQuantity?: Maybe<Scalars['Float']['output']>;
  totalHeldValueUSD: Scalars['Money']['output'];
  holdings?: Maybe<Array<Holding>>;
}

export interface AssetAdapterSource {
  __typename?: 'AssetAdapterSource';
  sourceAdapter: AssetSourceAdapter;
  sourceId: Scalars['String']['output'];
}

/** Live price quote for a single ticker. */
export interface AssetQuote {
  __typename?: 'AssetQuote';
  ticker: Scalars['String']['output'];
  priceUSD: Scalars['Float']['output'];
  asOf: Scalars['DateTime']['output'];
}

export interface Holding {
  __typename?: 'Holding';
  assetId: Scalars['ID']['output'];
  asset: Asset;
  accountId: Scalars['ID']['output'];
  account: Account;
  /** May be null when a provider supplies valuation without quantity. */
  quantity?: Maybe<Scalars['Float']['output']>;
  valueUSD: Scalars['Money']['output'];
  /** True for user-managed snapshot holdings. */
  manual: Scalars['Boolean']['output'];
}

export interface HoldingRollup {
  __typename?: 'HoldingRollup';
  asset: Asset;
  /** Null when any contributing provider supplies valuation without quantity. */
  totalQuantity?: Maybe<Scalars['Float']['output']>;
  valueUSD: Scalars['Money']['output'];
  percentOfClassifier: Scalars['Float']['output'];
  holdings?: Maybe<Array<Holding>>;
}

export interface NetWorthPoint {
  __typename?: 'NetWorthPoint';
  date: Scalars['Date']['output'];
  totalAssetsUSD: Scalars['Money']['output'];
  totalLiabilitiesUSD: Scalars['Money']['output'];
  netWorthUSD: Scalars['Money']['output'];
}

/** One data point in the historical per-classifier asset series. */
export interface ClassifierHistoryPoint {
  __typename?: 'ClassifierHistoryPoint';
  date: Scalars['Date']['output'];
  classifier: AssetClassifier;
  /** Human-readable label, e.g. Public Assets. */
  label: Scalars['String']['output'];
  valueUSD: Scalars['Money']['output'];
}

/** One data point in the historical per-category liability series. */
export interface LiabilityHistoryPoint {
  __typename?: 'LiabilityHistoryPoint';
  date: Scalars['Date']['output'];
  category: LiabilityCategory;
  /** Human-readable label, e.g. Credit Card. */
  label: Scalars['String']['output'];
  /** Negative USD value representing the liability amount. */
  valueUSD: Scalars['Money']['output'];
}

export interface ClassifierBreakdown {
  __typename?: 'ClassifierBreakdown';
  classifier: AssetClassifier;
  label: Scalars['String']['output'];
  valueUSD: Scalars['Money']['output'];
  percentOfAssets: Scalars['Float']['output'];
  assetCount: Scalars['Int']['output'];
  holdings: Array<HoldingRollup>;
}

export interface LiabilityBreakdown {
  __typename?: 'LiabilityBreakdown';
  category: LiabilityCategory;
  label: Scalars['String']['output'];
  valueUSD: Scalars['Money']['output'];
  percentOfLiabilities: Scalars['Float']['output'];
  accountCount: Scalars['Int']['output'];
  accounts: Array<Account>;
}

export interface NetWorthReport {
  __typename?: 'NetWorthReport';
  asOfDate?: Maybe<Scalars['Date']['output']>;
  currentNetWorthUSD: Scalars['Money']['output'];
  currentAssetsUSD: Scalars['Money']['output'];
  currentLiabilitiesUSD: Scalars['Money']['output'];
  classifierBreakdown: Array<ClassifierBreakdown>;
  liabilityBreakdown: Array<LiabilityBreakdown>;
}

/** Historical net worth and per-classifier breakdown over a date range. */
export interface HistoricalNetWorthReport {
  __typename?: 'HistoricalNetWorthReport';
  /** Net worth time series over the requested range. */
  series: Array<NetWorthPoint>;
  /** Per-classifier asset value series over the requested range. */
  classifierSeries: Array<ClassifierHistoryPoint>;
  /** Per-category liability value series over the requested range. */
  liabilitySeries: Array<LiabilityHistoryPoint>;
}

/** A flagged balance snapshot review for a single account. */
export interface BalanceSnapshotReview extends Node {
  __typename?: 'BalanceSnapshotReview';
  id: Scalars['ID']['output'];
  account: Account;
  firstFlaggedDate: Scalars['Date']['output'];
  latestFlaggedDate: Scalars['Date']['output'];
  flaggedSnapshotCount: Scalars['Int']['output'];
  providerBalanceUSD: Scalars['Money']['output'];
  carryForwardBalanceUSD: Scalars['Money']['output'];
  flagReason?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  updatedAt: Scalars['DateTime']['output'];
}

export interface BalanceSnapshotReviewList {
  __typename?: 'BalanceSnapshotReviewList';
  items: Array<BalanceSnapshotReview>;
}

/** A single stored balance snapshot for one account on one local day, with per-asset holdings. */
export interface AccountSnapshot extends Node {
  __typename?: 'AccountSnapshot';
  id: Scalars['ID']['output'];
  /** Owning account ID. */
  accountId: Scalars['ID']['output'];
  /** Local-timezone day this snapshot represents (YYYY-MM-DD). */
  date: Scalars['Date']['output'];
  /** Stored total balance in USD for countable holdings in the snapshot. */
  balanceUSD: Scalars['Money']['output'];
  /** Sign-aware account value for this snapshot: assets are positive, liabilities negative. */
  netContributionUSD: Scalars['Money']['output'];
  /** Per-asset breakdown, including the CASH (USD) line. */
  holdings?: Maybe<Array<Holding>>;
  /** True when this snapshot is currently flagged by spike protection. */
  flagged: Scalars['Boolean']['output'];
}

export interface AccountSnapshotConnection {
  __typename?: 'AccountSnapshotConnection';
  edges: Array<AccountSnapshotEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
}

export interface AccountSnapshotEdge {
  __typename?: 'AccountSnapshotEdge';
  node: AccountSnapshot;
  cursor: Scalars['String']['output'];
}

export interface NetWorthInput {
  ownerIds?: InputMaybe<Array<Scalars['ID']['input']>>;
  accountIds?: InputMaybe<Array<Scalars['ID']['input']>>;
}

export interface HistoricalNetWorthInput {
  range: NetWorthRange;
  granularity?: InputMaybe<Granularity>;
  filters?: InputMaybe<NetWorthInput>;
}

export interface AssetsInput {
  assetType?: InputMaybe<AssetType>;
  priceConnectivity?: InputMaybe<ConnectivityStatus>;
  includeHistorical?: InputMaybe<Scalars['Boolean']['input']>;
  /** Full-text query matched against asset identifier and name; results are ranked by relevance. */
  search?: InputMaybe<Scalars['String']['input']>;
  investmentConnectivity?: InputMaybe<ConnectivityStatus>;
}

export interface AccountSnapshotInput {
  /** Resolve a specific snapshot row directly by its ID. */
  snapshotId?: InputMaybe<Scalars['ID']['input']>;
  /** Resolve by account. With date: latest snapshot on that local day. Without date: most recent snapshot. */
  accountId?: InputMaybe<Scalars['ID']['input']>;
  /** Local-timezone day (YYYY-MM-DD). Optional; omit for most recent. */
  date?: InputMaybe<Scalars['Date']['input']>;
}

export interface AccountSnapshotsInput {
  accountId: Scalars['ID']['input'];
  first?: InputMaybe<Scalars['Int']['input']>;
  after?: InputMaybe<Scalars['String']['input']>;
}

export interface SnapshotHoldingInput {
  assetId: Scalars['ID']['input'];
  /** New quantity. For cash this is the USD amount. */
  quantity?: InputMaybe<Scalars['Float']['input']>;
  /** New USD value for the holding line. */
  valueUSD: Scalars['Money']['input'];
}

export interface AssetList {
  __typename?: 'AssetList';
  items: Array<Asset>;
}

export interface UpdateSecurityAssetInput {
  cusip?: InputMaybe<Scalars['String']['input']>;
  isin?: InputMaybe<Scalars['String']['input']>;
}

export interface CreateSecurityAssetInput {
  cusip?: InputMaybe<Scalars['String']['input']>;
  isin?: InputMaybe<Scalars['String']['input']>;
}

export interface CreateAssetInput {
  assetType: AssetType;
  identifier: Scalars['String']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  classifier: AssetClassifier;
  /** Fixed USD price per unit. */
  forcedUsdPrice?: InputMaybe<Scalars['Float']['input']>;
  trackingTicker?: InputMaybe<Scalars['String']['input']>;
  trackingMultiplier?: InputMaybe<Scalars['Float']['input']>;
  security?: InputMaybe<CreateSecurityAssetInput>;
}

export interface CreateAssetPayload {
  __typename?: 'CreateAssetPayload';
  asset: Asset;
}

export interface UpdateAssetInput {
  id: Scalars['ID']['input'];
  identifier?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  classifier?: InputMaybe<AssetClassifier>;
  /** When false, clear any forced USD price. When true, forcedUsdPrice must be provided. */
  forcePrice?: InputMaybe<Scalars['Boolean']['input']>;
  /** Fixed USD price per unit. */
  forcedUsdPrice?: InputMaybe<Scalars['Float']['input']>;
  trackingTicker?: InputMaybe<Scalars['String']['input']>;
  trackingMultiplier?: InputMaybe<Scalars['Float']['input']>;
  priceConnectivity?: InputMaybe<ConnectivityStatus>;
  security?: InputMaybe<UpdateSecurityAssetInput>;
  investmentConnectivity?: InputMaybe<ConnectivityStatus>;
}

export interface UpdateAssetPayload {
  __typename?: 'UpdateAssetPayload';
  asset: Asset;
}

export interface MergeAssetInput {
  /** Identifies the adapter-source row to re-point (currently on the duplicate). */
  sourceAdapter: AssetSourceAdapter;
  sourceId: Scalars['String']['input'];
  /** The surviving asset that absorbs the duplicate. */
  assetId: Scalars['ID']['input'];
}

export interface MergeAssetPayload {
  __typename?: 'MergeAssetPayload';
  asset: Asset;
}

export interface LinkRealEstateInput {
  street?: InputMaybe<Scalars['String']['input']>;
  city?: InputMaybe<Scalars['String']['input']>;
  state?: InputMaybe<Scalars['String']['input']>;
  zip?: InputMaybe<Scalars['String']['input']>;
  homeType?: InputMaybe<Scalars['String']['input']>;
  ownerId: Scalars['ID']['input'];
  label?: InputMaybe<Scalars['String']['input']>;
  manualValuationUSD: Scalars['Money']['input'];
}

export interface LinkRealEstatePayload {
  __typename?: 'LinkRealEstatePayload';
  connection: Connection;
  account: Account;
  valuationUSD: Scalars['Money']['output'];
}

export interface UpdateRealEstateInput {
  connectionId: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  street?: InputMaybe<Scalars['String']['input']>;
  city?: InputMaybe<Scalars['String']['input']>;
  state?: InputMaybe<Scalars['String']['input']>;
  zip?: InputMaybe<Scalars['String']['input']>;
  homeType?: InputMaybe<Scalars['String']['input']>;
  valuationUSD?: InputMaybe<Scalars['Money']['input']>;
}

export interface UpdateRealEstatePayload {
  __typename?: 'UpdateRealEstatePayload';
  account: Account;
}

export interface ResolveBalanceReviewInput {
  id: Scalars['ID']['input'];
  /** APPROVE_CHANGES keeps carry-forward; USE_PROVIDER restores provider data. */
  action: BalanceReviewAction;
}

export interface ResolveBalanceReviewPayload {
  __typename?: 'ResolveBalanceReviewPayload';
  success: Scalars['Boolean']['output'];
}

export interface ChangeAccountSnapshotInput {
  /** Snapshot ID returned by accountSnapshot(); updated in place. */
  snapshotId: Scalars['ID']['input'];
  /** Full replacement holdings set. Include 0-quantity lines to zero an asset. */
  holdings: Array<SnapshotHoldingInput>;
}

export interface ChangeAccountSnapshotPayload {
  __typename?: 'ChangeAccountSnapshotPayload';
  snapshot: AccountSnapshot;
  /** The refreshed account, so clients can update net worth and holdings views. */
  account: Account;
}
