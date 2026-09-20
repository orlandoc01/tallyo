use anyhow::Result;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};

use crate::{
    apierror::ApiError,
    ids::{GlobalId, GlobalIdType},
    schema::AccountSnapshotsInput,
};

use super::{AccountSnapshotConnection, AccountSnapshotEdge, PageInfo, WealthService, store};

const DEFAULT_LIMIT: i32 = 20;
const MAX_LIMIT: i32 = 100;
const INVALID_CURSOR: &str = "invalid cursor";

#[derive(Deserialize, Serialize)]
struct AccountSnapshotCursor {
    date: String,
}

impl WealthService {
    pub async fn account_snapshots(&self, input: AccountSnapshotsInput) -> Result<AccountSnapshotConnection> {
        let account_id = GlobalId::decode(input.account_id.as_str())?.i64_of_type(GlobalIdType::Account)?;
        let limit = account_snapshot_limit(input.first)?;
        let after_date = input.after.as_deref().map(decode_account_snapshot_cursor).transpose()?;
        let mut rows =
            store::account_balance_snapshots_page(&self.pool, account_id, after_date.as_deref(), i64::from(limit + 1))
                .await?;
        let total_count = store::account_balance_snapshot_day_count(&self.pool, account_id).await? as i32;
        let has_next_page = rows.len() > limit as usize;
        rows.truncate(limit as usize);
        self.account_snapshot_connection(rows, total_count, has_next_page, input.after.is_some())
            .await
    }

    async fn account_snapshot_connection(
        &self,
        rows: Vec<super::SnapshotRow>,
        total_count: i32,
        has_next_page: bool,
        has_previous_page: bool,
    ) -> Result<AccountSnapshotConnection> {
        if rows.is_empty() {
            return Ok(AccountSnapshotConnection {
                edges: Vec::new(),
                page_info: PageInfo {
                    has_next_page,
                    has_previous_page,
                    start_cursor: None,
                    end_cursor: None,
                },
                total_count,
            });
        }
        let ids = rows.iter().map(|row| row.id).collect::<Vec<_>>();
        let holdings = store::snapshot_holdings_by_snapshot_ids(&self.pool, &ids).await?;
        let edges = rows
            .into_iter()
            .map(|row| {
                let cursor = encode_account_snapshot_cursor(&row.date);
                self.account_snapshot_model_from_parts(row.clone(), holdings.get(&row.id).cloned().unwrap_or_default())
                    .map(|node| AccountSnapshotEdge { node, cursor })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(AccountSnapshotConnection {
            page_info: PageInfo {
                has_next_page,
                has_previous_page,
                start_cursor: edges.first().map(|edge| edge.cursor.clone()),
                end_cursor: edges.last().map(|edge| edge.cursor.clone()),
            },
            edges,
            total_count,
        })
    }
}

fn account_snapshot_limit(first: Option<i32>) -> Result<i32> {
    match first.unwrap_or(DEFAULT_LIMIT) {
        first if first <= 0 => Err(ApiError::bad_input("first must be positive").into()),
        first if first > MAX_LIMIT => Err(ApiError::bad_input("first must not exceed 100").into()),
        first => Ok(first),
    }
}

fn encode_account_snapshot_cursor(date: &str) -> String {
    URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(&AccountSnapshotCursor { date: date.to_owned() }).expect("cursor serializes"))
}

fn decode_account_snapshot_cursor(cursor: &str) -> Result<String> {
    let bytes = URL_SAFE_NO_PAD.decode(cursor).map_err(|_| invalid_cursor())?;
    let cursor = serde_json::from_slice::<AccountSnapshotCursor>(&bytes).map_err(|_| invalid_cursor())?;
    crate::ids::Date::new(cursor.date.clone()).map_err(|_| invalid_cursor())?;
    Ok(cursor.date)
}

fn invalid_cursor() -> ApiError {
    ApiError::bad_input(INVALID_CURSOR)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::{
        WealthService, account_snapshot_limit, decode_account_snapshot_cursor, encode_account_snapshot_cursor,
    };
    use crate::{
        database::dbtest,
        ids::{GlobalId, GlobalIdType},
        schema::AccountSnapshotsInput,
    };

    #[test]
    fn validates_cursor_structure_and_page_limits() {
        assert_eq!(account_snapshot_limit(None).unwrap(), 20);
        assert_eq!(
            account_snapshot_limit(Some(0)).unwrap_err().to_string(),
            "first must be positive"
        );
        assert_eq!(
            account_snapshot_limit(Some(101)).unwrap_err().to_string(),
            "first must not exceed 100"
        );
        assert_eq!(
            decode_account_snapshot_cursor(&encode_account_snapshot_cursor("2026-09-06")).unwrap(),
            "2026-09-06"
        );
        assert_eq!(
            decode_account_snapshot_cursor("bad").unwrap_err().to_string(),
            "invalid cursor"
        );
    }

    #[tokio::test]
    async fn paginates_snapshot_connections_and_preserves_page_info() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query("INSERT INTO owners (id, name) VALUES (2, 'Owner')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (2, 'account', 2, 'Account', 'DEPOSITORY'), (3, 'empty', 2, 'Empty', 'DEPOSITORY')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO account_balance_daily_snapshots (id, account_id, source, date, synced_at, balance_usd_cents) VALUES (20, 2, 'manual', '2026-01-01', '2026-01-01T12:00:00Z', 100), (21, 2, 'manual', '2026-01-02', '2026-01-02T12:00:00Z', 200), (22, 2, 'manual', '2026-01-03', '2026-01-03T12:00:00Z', 300)")
            .execute(&pool)
            .await?;
        let service = WealthService::new(pool, None, || "UTC".to_owned());
        let account_id = |id| GlobalId::new(GlobalIdType::Account, id).encoded_string().into();

        let first = service
            .account_snapshots(AccountSnapshotsInput {
                account_id: account_id(2),
                first: Some(2),
                after: None,
            })
            .await?;
        let second = service
            .account_snapshots(AccountSnapshotsInput {
                account_id: account_id(2),
                first: Some(2),
                after: first.page_info.end_cursor.clone(),
            })
            .await?;
        let empty = service
            .account_snapshots(AccountSnapshotsInput {
                account_id: account_id(3),
                first: Some(1),
                after: None,
            })
            .await?;

        assert_eq!(first.total_count, 3);
        assert_eq!(
            first.edges.iter().map(|edge| edge.node.id).collect::<Vec<_>>(),
            [22, 21]
        );
        assert!(first.page_info.has_next_page);
        assert_eq!(second.edges[0].node.id, 20);
        assert!(second.page_info.has_previous_page);
        assert!(empty.edges.is_empty());
        assert!(empty.page_info.start_cursor.is_none());
        Ok(())
    }
}
