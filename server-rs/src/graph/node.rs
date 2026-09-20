use std::collections::HashSet;

use anyhow::{Result, ensure};

use super::{Resolver, ids::decode, operation_scope, require_scope};
use crate::{
    accounts::store as accounts,
    admin::store as admin,
    apierror::ApiError,
    auth::Identity,
    budgets::store as budgets,
    ids::{GlobalId, GlobalIdType},
    schema::{AccountSnapshotInput, Node},
    transactions::store as transactions,
    wealth::store as wealth,
};

pub(crate) const MAX_NODE_IDS: usize = 100;

impl Resolver {
    pub async fn node(&self, identity: &Identity, id: &async_graphql::ID) -> Result<Option<Node>> {
        let id = decode(id)?;
        require_node_scope(identity, id.typ)?;
        self.fetch_node(id).await
    }

    pub async fn nodes(&self, identity: &Identity, ids: &[async_graphql::ID]) -> Result<Vec<Option<Node>>> {
        ensure!(
            ids.len() <= MAX_NODE_IDS,
            ApiError::bad_input(format!("nodes accepts at most {MAX_NODE_IDS} ids"))
        );
        let ids = ids.iter().map(decode).collect::<Result<Vec<_>>>()?;
        let mut checked = HashSet::new();
        for typ in ids.iter().map(|id| id.typ) {
            if checked.insert(typ) {
                require_node_scope(identity, typ)?;
            }
        }
        let mut nodes = Vec::with_capacity(ids.len());
        for id in ids {
            nodes.push(self.fetch_node(id).await?);
        }
        Ok(nodes)
    }

    async fn fetch_node(&self, id: GlobalId) -> Result<Option<Node>> {
        let pool = &self.pool;
        let local = id.i64();
        Ok(match id.typ {
            GlobalIdType::Account => accounts::account_by_id(pool, local).await?.map(Node::Account),
            GlobalIdType::Asset => wealth::asset_by_id(pool, local).await?.map(Node::Asset),
            GlobalIdType::BalanceSnapshotReview => wealth::get_balance_review_by_id(pool, local)
                .await?
                .map(Node::BalanceSnapshotReview),
            GlobalIdType::AccountSnapshot => self
                .wealth
                .account_snapshot(AccountSnapshotInput {
                    snapshot_id: Some(id.encoded_string().into()),
                    account_id: None,
                    date: None,
                })
                .await?
                .map(Node::AccountSnapshot),
            GlobalIdType::Budget => budgets::budget_by_id(pool, local).await?.map(Node::Budget),
            GlobalIdType::Category => transactions::category_by_id(pool, local).await?.map(Node::Category),
            GlobalIdType::CategoryGroup => transactions::category_group_by_id(pool, local)
                .await?
                .map(Node::CategoryGroup),
            GlobalIdType::Rule => transactions::rule_by_id(pool, local).await?.map(Node::Rule),
            GlobalIdType::Tag => transactions::tag_by_id(pool, local).await?.map(Node::Tag),
            GlobalIdType::Connection => accounts::connection_by_id(pool, local)
                .await?
                .map(|record| Node::Connection(record.connection)),
            GlobalIdType::Owner => accounts::owner_by_id(pool, local).await?.map(Node::Owner),
            GlobalIdType::PlaidItem => accounts::plaid_item_by_id(pool, local)
                .await?
                .map(|record| Node::PlaidItem(record.item)),
            GlobalIdType::RecurringCharge => transactions::recurring_charge_by_id(pool, local)
                .await?
                .map(Node::RecurringCharge),
            GlobalIdType::SimpleFinAccessToken => accounts::simple_fin_access_token_by_id(pool, local)
                .await?
                .map(Node::SimpleFinAccessToken),
            GlobalIdType::SimpleFinConnection => accounts::simple_fin_connection_by_conn_id(pool, local)
                .await?
                .map(|record| Node::SimpleFinConnection(record.connection)),
            GlobalIdType::Transaction => transactions::transaction_by_id(pool, local)
                .await?
                .map(Node::Transaction),
            GlobalIdType::User => admin::find_user(pool, local).await?.map(Node::User),
        })
    }
}

// Go's nodeScopeQuery: the Query field whose @requiresScope guards each node type.
const fn node_scope_query(typ: GlobalIdType) -> &'static str {
    match typ {
        GlobalIdType::Account => "account",
        GlobalIdType::Asset => "assets",
        GlobalIdType::BalanceSnapshotReview => "balanceSnapshotReviews",
        GlobalIdType::AccountSnapshot => "accountSnapshot",
        GlobalIdType::Budget => "budgetReport",
        GlobalIdType::Category => "categories",
        GlobalIdType::CategoryGroup => "categoryGroups",
        GlobalIdType::Rule => "rules",
        GlobalIdType::Tag => "tags",
        GlobalIdType::Connection | GlobalIdType::SimpleFinConnection => "connections",
        GlobalIdType::Owner => "owners",
        GlobalIdType::PlaidItem => "plaidItems",
        GlobalIdType::RecurringCharge => "recurringCharges",
        GlobalIdType::SimpleFinAccessToken => "simpleFinAccessTokens",
        GlobalIdType::Transaction => "transaction",
        GlobalIdType::User => "users",
    }
}

fn require_node_scope(identity: &Identity, typ: GlobalIdType) -> Result<()> {
    let scope = operation_scope("Query", node_scope_query(typ))?;
    require_scope(Some(identity), scope).map(drop).map_err(Into::into)
}
