import { gql } from 'urql'
import { ACCOUNT_FIELDS, ACCOUNT_WITH_SNAPSHOT_FIELDS, ACCOUNT_WITH_SNAPSHOT_SUMMARY_FIELDS, ASSET_FIELDS, CATEGORY_FIELDS, CONFIGURATION_FIELDS, CONNECTION_PROVIDER_FIELDS, OWNER_FIELDS, PLAID_CREDENTIAL_FIELDS, PLAID_ITEM_SUMMARY_FIELDS, TAG_FIELDS, TRANSACTION_FIELDS } from './queries'

const CATEGORY_GROUP_FIELDS = gql`
  ${CATEGORY_FIELDS}
  fragment CategoryGroupFields on CategoryGroup {
    id
    name
    emoji
    kind
    categories {
      ...CategoryFields
    }
  }
`

export const CREATE_CATEGORY_GROUP_MUTATION = gql`
  ${CATEGORY_GROUP_FIELDS}
  mutation CreateCategoryGroup($input: CreateCategoryGroupInput!) {
    createCategoryGroup(input: $input) {
      group {
        ...CategoryGroupFields
      }
    }
  }
`

export const UPDATE_CATEGORY_GROUP_MUTATION = gql`
  ${CATEGORY_GROUP_FIELDS}
  mutation UpdateCategoryGroup($input: UpdateCategoryGroupInput!) {
    updateCategoryGroup(input: $input) {
      group {
        ...CategoryGroupFields
      }
    }
  }
`

export const DELETE_CATEGORY_GROUP_MUTATION = gql`
  mutation DeleteCategoryGroup($id: ID!) {
    deleteCategoryGroup(id: $id) {
      success
    }
  }
`

export const CREATE_CATEGORY_MUTATION = gql`
  ${CATEGORY_FIELDS}
  mutation CreateCategory($input: CreateCategoryInput!) {
    createCategory(input: $input) {
      category {
        ...CategoryFields
      }
    }
  }
`

export const UPDATE_CATEGORY_MUTATION = gql`
  ${CATEGORY_FIELDS}
  mutation UpdateCategory($input: UpdateCategoryInput!) {
    updateCategory(input: $input) {
      category {
        ...CategoryFields
      }
    }
  }
`

export const DELETE_CATEGORY_MUTATION = gql`
  mutation DeleteCategory($id: ID!) {
    deleteCategory(id: $id) {
      success
    }
  }
`

export const REORDER_CATEGORIES_MUTATION = gql`
  ${CATEGORY_GROUP_FIELDS}
  mutation ReorderCategories($input: ReorderCategoriesInput!) {
    reorderCategories(input: $input) {
      group {
        ...CategoryGroupFields
      }
    }
  }
`

export const CREATE_RULE_MUTATION = gql`
  ${CATEGORY_FIELDS}
  ${ACCOUNT_FIELDS}
  ${TAG_FIELDS}
  mutation CreateRule($input: CreateRuleInput!) {
    createRule(input: $input) {
      rule {
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

export const UPDATE_RULE_MUTATION = gql`
  ${CATEGORY_FIELDS}
  ${ACCOUNT_FIELDS}
  ${TAG_FIELDS}
  mutation UpdateRule($input: UpdateRuleInput!) {
    updateRule(input: $input) {
      rule {
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

export const CREATE_TAG_MUTATION = gql`
  ${TAG_FIELDS}
  mutation CreateTag($input: CreateTagInput!) {
    createTag(input: $input) {
      tag { ...TagFields }
    }
  }
`

export const UPDATE_TAG_MUTATION = gql`
  ${TAG_FIELDS}
  mutation UpdateTag($input: UpdateTagInput!) {
    updateTag(input: $input) {
      tag { ...TagFields }
    }
  }
`

export const DELETE_TAG_MUTATION = gql`
  mutation DeleteTag($id: ID!) {
    deleteTag(id: $id) { success }
  }
`

export const DELETE_RULE_MUTATION = gql`
  mutation DeleteRule($id: ID!) {
    deleteRule(id: $id) {
      success
    }
  }
`

export const UPDATE_CONFIGURATION_MUTATION = gql`
  ${CONFIGURATION_FIELDS}
  mutation UpdateConfiguration($input: UpdateConfigurationInput!) {
    updateConfiguration(input: $input) {
      configuration {
        ...ConfigurationFields
      }
    }
  }
`

export const CREATE_INVITE_LINK_MUTATION = gql`
  mutation CreateInviteLink($input: CreateInviteLinkInput!) {
    createInviteLink(input: $input) {
      url
      expiresAt
    }
  }
`

export const BULK_DELETE_TRANSACTIONS_MUTATION = gql`
  mutation BulkDeleteTransactions($input: BulkDeleteTransactionsInput!) {
    bulkDeleteTransactions(input: $input) {
      deletedCount
    }
  }
`

export const UPDATE_TRANSACTION_MUTATION = gql`
  ${TRANSACTION_FIELDS}
  mutation UpdateTransaction($input: UpdateTransactionInput!) {
    updateTransaction(input: $input) {
      transaction {
        ...TransactionFields
      }
    }
  }
`

export const REPROCESS_UNCATEGORIZED_MUTATION = gql`
  mutation ReprocessUncategorizedTransactions {
    reprocessUncategorizedTransactions {
      stagedCount
    }
  }
`

export const BULK_UPDATE_TRANSACTIONS_MUTATION = gql`
  ${TRANSACTION_FIELDS}
  mutation BulkUpdateTransactions($input: BulkUpdateTransactionsInput!) {
    bulkUpdateTransactions(input: $input) {
      updatedCount
      transactions {
        ...TransactionFields
      }
    }
  }
`

export const CREATE_TRANSACTION_MUTATION = gql`
  ${TRANSACTION_FIELDS}
  mutation CreateTransaction($input: CreateTransactionInput!) {
    createTransaction(input: $input) {
      transaction {
        ...TransactionFields
      }
    }
  }
`

export const DELETE_TRANSACTION_MUTATION = gql`
  mutation DeleteTransaction($id: ID!) {
    deleteTransaction(id: $id) {
      success
    }
  }
`

export const CREATE_LINK_TOKEN_MUTATION = gql`
  mutation CreateLinkToken($input: CreateLinkTokenInput!) {
    createLinkToken(input: $input) {
      linkToken
      expiration
    }
  }
`

export const CREATE_UPDATE_LINK_TOKEN_MUTATION = gql`
  mutation CreateUpdateLinkToken($itemId: ID!) {
    createUpdateLinkToken(itemId: $itemId) {
      linkToken
      expiration
    }
  }
`

export const EXCHANGE_PUBLIC_TOKEN_MUTATION = gql`
  ${ACCOUNT_FIELDS}
  ${PLAID_ITEM_SUMMARY_FIELDS}
  mutation ExchangePublicToken($input: ExchangePublicTokenInput!) {
    exchangePublicToken(input: $input) {
      item {
        ...PlaidItemSummaryFields
        accounts {
          ...AccountFields
        }
      }
      accounts {
        ...AccountFields
      }
    }
  }
`

export const CREATE_SIMPLE_FIN_ACCESS_TOKEN_MUTATION = gql`
  ${ACCOUNT_FIELDS}
  mutation CreateSimpleFinAccessToken($input: CreateSimpleFinAccessTokenInput!) {
    createSimpleFinAccessToken(input: $input) {
      accessToken {
        __typename
        id
        label
        owner { ...OwnerFields }
        syncCron
        lastSyncedAt
        nextSyncAt
        createdAt
      }
      connections {
        __typename
        id
        orgDomain
        orgUrl
        lastSyncedAt
        createdAt
        updatedAt
        accounts {
          ...AccountFields
        }
      }
      accounts {
        ...AccountFields
      }
    }
  }
`

export const DELETE_SIMPLE_FIN_ACCESS_TOKEN_MUTATION = gql`
  mutation DeleteSimpleFinAccessToken($id: ID!) {
    deleteSimpleFinAccessToken(id: $id)
  }
`

export const RESET_SIMPLE_FIN_SYNC_MUTATION = gql`
  ${OWNER_FIELDS}
  mutation ResetSimpleFinSync($id: ID!) {
    resetSimpleFinSync(id: $id) {
      __typename
      id
      label
      syncCron
      lastSyncedAt
      nextSyncAt
      createdAt
      owner { ...OwnerFields }
    }
  }
`

export const COMPLETE_LINK_UPDATE_MUTATION = gql`
  ${ACCOUNT_FIELDS}
  ${PLAID_ITEM_SUMMARY_FIELDS}
  mutation CompleteLinkUpdate($itemId: ID!) {
    completeLinkUpdate(itemId: $itemId) {
      item {
        ...PlaidItemSummaryFields
        accounts {
          ...AccountFields
        }
      }
    }
  }
`

export const UPDATE_CONNECTION_MUTATION = gql`
  ${ACCOUNT_FIELDS}
  ${CONNECTION_PROVIDER_FIELDS}
  mutation UpdateConnection($input: UpdateConnectionInput!) {
    updateConnection(input: $input) {
      connection {
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

export const DELETE_CONNECTION_MUTATION = gql`
  mutation DeleteConnection($input: DeleteConnectionInput!) {
    deleteConnection(input: $input) {
      success
    }
  }
`

export const UPDATE_ACCOUNT_MUTATION = gql`
  ${ACCOUNT_WITH_SNAPSHOT_SUMMARY_FIELDS}
  mutation UpdateAccount($input: UpdateAccountInput!) {
    updateAccount(input: $input) {
      account {
        ...AccountWithSnapshotSummaryFields
      }
    }
  }
`

export const REMOVE_MANUAL_ACCOUNT_MUTATION = gql`
  mutation RemoveManualAccount($input: RemoveManualAccountInput!) {
    removeManualAccount(input: $input) {
      success
    }
  }
`

export const ADD_USER_MUTATION = gql`
  mutation AddUser($input: AddUserInput!) {
    addUser(input: $input) {
      user {
        id
        email
        role
        createdAt
      }
    }
  }
`

export const REMOVE_USER_MUTATION = gql`
  mutation RemoveUser($input: RemoveUserInput!) {
    removeUser(input: $input) {
      success
    }
  }
`

export const UPDATE_USER_MUTATION = gql`
  mutation UpdateUser($input: UpdateUserInput!) {
    updateUser(input: $input) {
      user {
        id
        email
        role
        createdAt
      }
    }
  }
`

export const CREATE_PLAID_CREDENTIAL_MUTATION = gql`
  ${PLAID_CREDENTIAL_FIELDS}
  mutation CreatePlaidCredential($input: CreatePlaidCredentialInput!) {
    createPlaidCredential(input: $input) {
      credential {
        ...PlaidCredentialFields
      }
    }
  }
`

export const UPDATE_PLAID_CREDENTIAL_MUTATION = gql`
  ${PLAID_CREDENTIAL_FIELDS}
  mutation UpdatePlaidCredential($input: UpdatePlaidCredentialInput!) {
    updatePlaidCredential(input: $input) {
      credential {
        ...PlaidCredentialFields
      }
    }
  }
`

export const DELETE_PLAID_CREDENTIAL_MUTATION = gql`
  mutation DeletePlaidCredential($input: DeletePlaidCredentialInput!) {
    deletePlaidCredential(input: $input) {
      success
    }
  }
`

export const CREATE_MANUAL_ACCOUNT_MUTATION = gql`
  ${ACCOUNT_WITH_SNAPSHOT_SUMMARY_FIELDS}
  mutation CreateManualAccount($input: CreateManualAccountInput!) {
    createManualAccount(input: $input) {
      account {
        ...AccountWithSnapshotSummaryFields
      }
    }
  }
`

export const CREATE_OWNER_MUTATION = gql`
  mutation CreateOwner($input: CreateOwnerInput!) {
    createOwner(input: $input) {
      id
      name
    }
  }
`

export const DELETE_OWNER_MUTATION = gql`
  mutation DeleteOwner($id: ID!) {
    deleteOwner(id: $id)
  }
`

export const UPDATE_ASSET_MUTATION = gql`
  ${ASSET_FIELDS}
  mutation UpdateAsset($input: UpdateAssetInput!) {
    updateAsset(input: $input) {
      asset {
        ...AssetFields
      }
    }
  }
`

export const CREATE_ASSET_MUTATION = gql`
  ${ASSET_FIELDS}
  mutation CreateAsset($input: CreateAssetInput!) {
    createAsset(input: $input) {
      asset {
        ...AssetFields
      }
    }
  }
`

export const MERGE_ASSET_MUTATION = gql`
  ${ASSET_FIELDS}
  mutation MergeAsset($input: MergeAssetInput!) {
    mergeAsset(input: $input) {
      asset {
        ...AssetFields
      }
    }
  }
`

export const LINK_EVM_WALLET_MUTATION = gql`
  ${ACCOUNT_WITH_SNAPSHOT_SUMMARY_FIELDS}
  ${CONNECTION_PROVIDER_FIELDS}
  mutation LinkEVMWallet($input: LinkEVMWalletInput!) {
    linkEVMWallet(input: $input) {
      connection {
        __typename
        id
        name
        owner { ...OwnerFields }
        isActive
        provider {
          ...ConnectionProviderFields
        }
      }
      account {
        ...AccountWithSnapshotSummaryFields
      }
    }
  }
`

export const RESOLVE_BALANCE_REVIEW_MUTATION = gql`
  mutation ResolveBalanceReview($input: ResolveBalanceReviewInput!) {
    resolveBalanceReview(input: $input) {
      success
    }
  }
`

export const CHANGE_ACCOUNT_SNAPSHOT_MUTATION = gql`
  ${ACCOUNT_WITH_SNAPSHOT_FIELDS}
  mutation ChangeAccountSnapshot($input: ChangeAccountSnapshotInput!) {
    changeAccountSnapshot(input: $input) {
      snapshot {
        ...AccountSnapshotFields
      }
      account {
        ...AccountWithSnapshotFields
      }
    }
  }
`

export const LINK_REAL_ESTATE_MUTATION = gql`
  ${ACCOUNT_WITH_SNAPSHOT_SUMMARY_FIELDS}
  ${CONNECTION_PROVIDER_FIELDS}
  mutation LinkRealEstate($input: LinkRealEstateInput!) {
    linkRealEstate(input: $input) {
      connection {
        __typename
        id
        name
        owner { ...OwnerFields }
        isActive
        provider {
          ...ConnectionProviderFields
        }
      }
      account {
        ...AccountWithSnapshotSummaryFields
      }
      valuationUSD
    }
  }
`

export const UPDATE_REAL_ESTATE_MUTATION = gql`
  ${ACCOUNT_WITH_SNAPSHOT_SUMMARY_FIELDS}
  mutation UpdateRealEstate($input: UpdateRealEstateInput!) {
    updateRealEstate(input: $input) {
      account {
        ...AccountWithSnapshotSummaryFields
      }
    }
  }
`

export const UNLINK_REAL_ESTATE_MUTATION = gql`
  mutation UnlinkRealEstate($id: ID!) {
    unlinkRealEstate(id: $id)
  }
`


export const SET_BUDGET_MUTATION = gql`
  ${CATEGORY_FIELDS}
  mutation SetBudget($input: SetBudgetInput!) {
    setBudget(input: $input) {
      budget {
        id
        month
        amount
        category { ...CategoryFields }
      }
    }
  }
`

export const DELETE_BUDGET_MUTATION = gql`
  mutation DeleteBudget($input: DeleteBudgetInput!) {
    deleteBudget(input: $input) {
      success
    }
  }
`

export const COPY_BUDGETS_MUTATION = gql`
  mutation CopyBudgets($input: CopyBudgetsInput!) {
    copyBudgets(input: $input) {
      copiedCount
    }
  }
`
