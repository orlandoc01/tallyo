use std::borrow::Cow;

use async_graphql::{Context, ID, Result};

use super::Resolver;
use crate::{
    auth::Identity,
    schema::{
        Account, AccountList, AccountSnapshot, AccountSnapshotConnection, AccountSnapshotInput, AccountSnapshotsInput,
        AddUserInput, AddUserPayload, AnalysisInput, AnalysisReport, AssetList, AssetQuote, AssetsInput,
        BalanceSnapshotReviewList, BudgetReport, BudgetReportHistory, BudgetReportHistoryInput, BudgetReportInput,
        BulkDeleteTransactionsInput, BulkDeleteTransactionsPayload, BulkUpdateTransactionsInput,
        BulkUpdateTransactionsPayload, CashFlowReport, CategoryGroupList, CategoryList, ChangeAccountSnapshotInput,
        ChangeAccountSnapshotPayload, CompleteLinkUpdatePayload, Configuration, ConnectionList, ConnectionsInput,
        CopyBudgetsInput, CopyBudgetsPayload, CreateAssetInput, CreateAssetPayload, CreateCategoryGroupInput,
        CreateCategoryGroupPayload, CreateCategoryInput, CreateCategoryPayload, CreateInviteLinkInput,
        CreateInviteLinkPayload, CreateLinkTokenInput, CreateLinkTokenPayload, CreateManualAccountInput,
        CreateManualAccountPayload, CreateOwnerInput, CreatePlaidCredentialInput, CreatePlaidCredentialPayload,
        CreateRuleInput, CreateRulePayload, CreateSimpleFinAccessTokenInput, CreateSimpleFinAccessTokenPayload,
        CreateTagInput, CreateTagPayload, CreateTransactionInput, CreateTransactionPayload, DeleteBudgetInput,
        DeleteBudgetPayload, DeleteCategoryGroupPayload, DeleteCategoryPayload, DeleteConnectionInput,
        DeleteConnectionPayload, DeletePlaidCredentialInput, DeletePlaidCredentialPayload, DeleteRulePayload,
        DeleteTagPayload, DeleteTransactionPayload, EvmChainList, ExchangePublicTokenInput, ExchangePublicTokenPayload,
        GeneralConfiguration, HistoricalNetWorthInput, HistoricalNetWorthReport, LinkEvmWalletInput,
        LinkEvmWalletPayload, LinkRealEstateInput, LinkRealEstatePayload, MergeAssetInput, MergeAssetPayload, Mutation,
        MutationResolvers, NetWorthInput, NetWorthReport, Node, Owner, OwnerList, PlaidCredentialList, PlaidItemList,
        PlaidItemsInput, Query, QueryResolvers, RecurringChargeList, RemoveManualAccountInput,
        RemoveManualAccountPayload, RemoveUserInput, RemoveUserPayload, ReorderCategoriesInput,
        ReorderCategoriesPayload, ReprocessUncategorizedTransactionsPayload, ResolveBalanceReviewInput,
        ResolveBalanceReviewPayload, RuleList, RulesInput, SetBudgetInput, SetBudgetPayload, SimpleFinAccessToken,
        SimpleFinAccessTokenList, SpendingByCategoryReport, SpendingFilter, TagList, Transaction,
        TransactionConnection, TransactionsFilter, TransactionsInput, TransactionsStagedForCategorization,
        TransactionsSummary, UpdateAccountInput, UpdateAccountPayload, UpdateAssetInput, UpdateAssetPayload,
        UpdateCategoryGroupInput, UpdateCategoryGroupPayload, UpdateCategoryInput, UpdateCategoryPayload,
        UpdateConfigurationInput, UpdateConfigurationPayload, UpdateConnectionInput, UpdateConnectionPayload,
        UpdatePlaidCredentialInput, UpdatePlaidCredentialPayload, UpdateRealEstateInput, UpdateRealEstatePayload,
        UpdateRuleInput, UpdateRulePayload, UpdateTagInput, UpdateTagPayload, UpdateTransactionInput,
        UpdateTransactionPayload, UpdateUserInput, UpdateUserPayload, UserList,
    },
};

// Dynamic-scope fields have no guard, so an absent identity must still fail the scope check.
fn identity<'a>(ctx: &Context<'a>) -> Cow<'a, Identity> {
    ctx.data_opt::<Identity>()
        .map_or_else(|| Cow::Owned(Identity::with_scopes(Vec::new())), Cow::Borrowed)
}

macro_rules! delegate {
    ($trait:ident for $root:ident {
        $($name:ident($($arg:ident: $ty:ty),*) -> $ret:ty => |$resolver:ident $(, $identity:ident)?| $call:expr;)*
    }) => {
        impl $trait for $root {
            $(
                async fn $name(&self, ctx: &Context<'_>, $($arg: $ty),*) -> Result<$ret> {
                    let $resolver = ctx.data::<Resolver>()?;
                    $(let $identity = identity(ctx);)?
                    let value: anyhow::Result<$ret> = $call.await;
                    Ok(value?)
                }
            )*
        }
    };
}

delegate!(QueryResolvers for Query {
    accounts() -> AccountList => |resolver| resolver.accounts();
    account(id: ID) -> Account => |resolver| resolver.account(&id);
    owners() -> OwnerList => |resolver| resolver.owners();
    plaid_items(input: Option<PlaidItemsInput>) -> PlaidItemList => |resolver| resolver.plaid_items(input);
    connections(input: Option<ConnectionsInput>) -> ConnectionList => |resolver| resolver.connections(input);
    evm_chains() -> EvmChainList => |resolver| async { Ok(resolver.evm_chains()) };
    simple_fin_access_tokens() -> SimpleFinAccessTokenList => |resolver| resolver.simple_fin_access_tokens();
    users() -> UserList => |resolver| resolver.users();
    plaid_credentials() -> PlaidCredentialList => |resolver| resolver.plaid_credentials();
    configuration() -> Configuration => |resolver| async { Ok(resolver.configuration()) };
    general_configuration() -> GeneralConfiguration => |resolver| async { Ok(resolver.general_configuration()) };
    instance_timezone() -> String => |resolver| async { Ok(resolver.instance_timezone()) };
    node(id: ID) -> Option<Node> => |resolver, identity| resolver.node(&identity, &id);
    nodes(ids: Vec<ID>) -> Option<Vec<Option<Node>>> => |resolver, identity| async { resolver.nodes(&identity, &ids).await.map(Some) };
    budget_report_history(input: Option<BudgetReportHistoryInput>) -> BudgetReportHistory => |resolver, identity| resolver.budget_report_history(&identity, input);
    budget_report(input: BudgetReportInput) -> BudgetReport => |resolver, identity| resolver.budget_report(&identity, input);
    analysis(input: AnalysisInput) -> AnalysisReport => |resolver| resolver.analysis(input);
    transactions(input: Option<TransactionsInput>) -> TransactionConnection => |resolver| resolver.transactions(input);
    transaction(id: ID) -> Option<Transaction> => |resolver| resolver.transaction(&id);
    transactions_summary(filter: Option<TransactionsFilter>) -> TransactionsSummary => |resolver| resolver.transactions_summary(filter);
    transactions_staged_for_categorization() -> TransactionsStagedForCategorization => |resolver| resolver.transactions_staged_for_categorization();
    recurring_charges() -> RecurringChargeList => |resolver| resolver.recurring_charges();
    categories() -> CategoryList => |resolver| resolver.categories();
    category_groups() -> CategoryGroupList => |resolver| resolver.category_groups();
    plaid_pfc2_codes() -> Vec<String> => |resolver| async { Ok(resolver.plaid_pfc2_codes()) };
    tags() -> TagList => |resolver| resolver.tags();
    rules(input: Option<RulesInput>) -> RuleList => |resolver| resolver.rules(input);
    spending_by_category(filter: SpendingFilter) -> SpendingByCategoryReport => |resolver, identity| resolver.spending_by_category(&identity, filter);
    cash_flow(filter: SpendingFilter) -> CashFlowReport => |resolver, identity| resolver.cash_flow(&identity, filter);
    net_worth(input: NetWorthInput) -> NetWorthReport => |resolver| resolver.net_worth(input);
    historical_net_worth(input: HistoricalNetWorthInput) -> HistoricalNetWorthReport => |resolver| resolver.historical_net_worth(input);
    asset_quote(ticker: String) -> AssetQuote => |resolver| resolver.asset_quote(&ticker);
    assets(input: Option<AssetsInput>) -> AssetList => |resolver| resolver.assets(input);
    balance_snapshot_reviews() -> BalanceSnapshotReviewList => |resolver| resolver.balance_snapshot_reviews();
    account_snapshot(input: AccountSnapshotInput) -> Option<AccountSnapshot> => |resolver| resolver.account_snapshot(input);
    account_snapshots(input: AccountSnapshotsInput) -> AccountSnapshotConnection => |resolver| resolver.account_snapshots(input);
});

delegate!(MutationResolvers for Mutation {
    create_owner(input: CreateOwnerInput) -> Owner => |resolver| resolver.create_owner(input);
    delete_owner(id: ID) -> bool => |resolver| resolver.delete_owner(&id);
    create_manual_account(input: CreateManualAccountInput) -> CreateManualAccountPayload => |resolver| resolver.create_manual_account(input);
    update_account(input: UpdateAccountInput) -> UpdateAccountPayload => |resolver| resolver.update_account(input);
    remove_manual_account(input: RemoveManualAccountInput) -> RemoveManualAccountPayload => |resolver| resolver.remove_manual_account(input);
    update_connection(input: UpdateConnectionInput) -> UpdateConnectionPayload => |resolver| resolver.update_connection(input);
    delete_connection(input: DeleteConnectionInput) -> DeleteConnectionPayload => |resolver| resolver.delete_connection(input);
    link_evm_wallet(input: LinkEvmWalletInput) -> LinkEvmWalletPayload => |resolver| resolver.link_evm_wallet(input);
    unlink_evm_wallet(id: ID) -> bool => |resolver| resolver.unlink_evm_wallet(&id);
    create_link_token(input: CreateLinkTokenInput) -> CreateLinkTokenPayload => |resolver| resolver.create_link_token(input);
    exchange_public_token(input: ExchangePublicTokenInput) -> ExchangePublicTokenPayload => |resolver| resolver.exchange_public_token(input);
    create_update_link_token(item_id: ID) -> CreateLinkTokenPayload => |resolver| resolver.create_update_link_token(&item_id);
    complete_link_update(item_id: ID) -> CompleteLinkUpdatePayload => |resolver| resolver.complete_link_update(&item_id);
    create_simple_fin_access_token(input: CreateSimpleFinAccessTokenInput) -> CreateSimpleFinAccessTokenPayload => |resolver| resolver.create_simple_fin_access_token(input);
    delete_simple_fin_access_token(id: ID) -> bool => |resolver| resolver.delete_simple_fin_access_token(&id);
    reset_simple_fin_sync(id: ID) -> SimpleFinAccessToken => |resolver| resolver.reset_simple_fin_sync(&id);
    add_user(input: AddUserInput) -> AddUserPayload => |resolver, identity| resolver.add_user(&identity, input);
    create_invite_link(input: CreateInviteLinkInput) -> CreateInviteLinkPayload => |resolver| resolver.create_invite_link(input);
    remove_user(input: RemoveUserInput) -> RemoveUserPayload => |resolver| resolver.remove_user(input);
    update_user(input: UpdateUserInput) -> UpdateUserPayload => |resolver| resolver.update_user(input);
    create_plaid_credential(input: CreatePlaidCredentialInput) -> CreatePlaidCredentialPayload => |resolver| resolver.create_plaid_credential(input);
    update_plaid_credential(input: UpdatePlaidCredentialInput) -> UpdatePlaidCredentialPayload => |resolver| resolver.update_plaid_credential(input);
    delete_plaid_credential(input: DeletePlaidCredentialInput) -> DeletePlaidCredentialPayload => |resolver| resolver.delete_plaid_credential(input);
    update_configuration(input: UpdateConfigurationInput) -> UpdateConfigurationPayload => |resolver| resolver.update_configuration(input);
    set_budget(input: SetBudgetInput) -> SetBudgetPayload => |resolver| resolver.set_budget(input);
    delete_budget(input: DeleteBudgetInput) -> DeleteBudgetPayload => |resolver| resolver.delete_budget(input);
    copy_budgets(input: CopyBudgetsInput) -> CopyBudgetsPayload => |resolver| resolver.copy_budgets(input);
    create_category_group(input: CreateCategoryGroupInput) -> CreateCategoryGroupPayload => |resolver| resolver.create_category_group(input);
    update_category_group(input: UpdateCategoryGroupInput) -> UpdateCategoryGroupPayload => |resolver| resolver.update_category_group(input);
    delete_category_group(id: ID) -> DeleteCategoryGroupPayload => |resolver| resolver.delete_category_group(&id);
    create_category(input: CreateCategoryInput) -> CreateCategoryPayload => |resolver| resolver.create_category(input);
    update_category(input: UpdateCategoryInput) -> UpdateCategoryPayload => |resolver| resolver.update_category(input);
    delete_category(id: ID) -> DeleteCategoryPayload => |resolver| resolver.delete_category(&id);
    reorder_categories(input: ReorderCategoriesInput) -> ReorderCategoriesPayload => |resolver| resolver.reorder_categories(input);
    create_tag(input: CreateTagInput) -> CreateTagPayload => |resolver| resolver.create_tag(input);
    update_tag(input: UpdateTagInput) -> UpdateTagPayload => |resolver| resolver.update_tag(input);
    delete_tag(id: ID) -> DeleteTagPayload => |resolver| resolver.delete_tag(&id);
    create_rule(input: CreateRuleInput) -> CreateRulePayload => |resolver| resolver.create_rule(input);
    update_rule(input: UpdateRuleInput) -> UpdateRulePayload => |resolver| resolver.update_rule(input);
    delete_rule(id: ID) -> DeleteRulePayload => |resolver| resolver.delete_rule(&id);
    create_transaction(input: CreateTransactionInput) -> CreateTransactionPayload => |resolver| resolver.create_transaction(input);
    update_transaction(input: UpdateTransactionInput) -> UpdateTransactionPayload => |resolver| resolver.update_transaction(input);
    delete_transaction(id: ID) -> DeleteTransactionPayload => |resolver| resolver.delete_transaction(&id);
    bulk_update_transactions(input: BulkUpdateTransactionsInput) -> BulkUpdateTransactionsPayload => |resolver| resolver.bulk_update_transactions(input);
    bulk_delete_transactions(input: BulkDeleteTransactionsInput) -> BulkDeleteTransactionsPayload => |resolver| resolver.bulk_delete_transactions(input);
    reprocess_uncategorized_transactions() -> ReprocessUncategorizedTransactionsPayload => |resolver| resolver.reprocess_uncategorized_transactions();
    create_asset(input: CreateAssetInput) -> CreateAssetPayload => |resolver| resolver.create_asset(input);
    update_asset(input: UpdateAssetInput) -> UpdateAssetPayload => |resolver| resolver.update_asset(input);
    merge_asset(input: MergeAssetInput) -> MergeAssetPayload => |resolver| resolver.merge_asset(input);
    link_real_estate(input: LinkRealEstateInput) -> LinkRealEstatePayload => |resolver| resolver.link_real_estate(input);
    update_real_estate(input: UpdateRealEstateInput) -> UpdateRealEstatePayload => |resolver| resolver.update_real_estate(input);
    unlink_real_estate(id: ID) -> bool => |resolver| resolver.unlink_real_estate(&id);
    resolve_balance_review(input: ResolveBalanceReviewInput) -> ResolveBalanceReviewPayload => |resolver| resolver.resolve_balance_review(input);
    change_account_snapshot(input: ChangeAccountSnapshotInput) -> ChangeAccountSnapshotPayload => |resolver| resolver.change_account_snapshot(input);
});
