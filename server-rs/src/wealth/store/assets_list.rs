use anyhow::Result;
use sqlx::SqlitePool;

use crate::{database::queries, schema::AssetsInput, wealth::Asset};

pub async fn all_assets(pool: &SqlitePool, input: AssetsInput) -> Result<Vec<Asset>> {
    let search = input.search.as_deref().map(str::trim).unwrap_or_default();
    let asset_type = input.asset_type.map(|value| value.to_string());
    let price_connectivity = input.price_connectivity.map(|value| value.to_string());
    let investment_connectivity = input.investment_connectivity.map(|value| value.to_string());
    let (fts_match, like_search, order_name, like_name, like_identifier) = match search {
        "" => (None, false, true, "".to_owned(), "".to_owned()),
        search if uses_fts(search) => (Some(fts_query(search)), false, false, "".to_owned(), "".to_owned()),
        search => {
            let search = search.to_ascii_lowercase();
            (None, true, true, search.clone(), search)
        }
    };
    queries::asset_records(
        pool,
        queries::AssetRecordsParams {
            fts_match: fts_match.as_deref(),
            asset_type: asset_type.as_deref(),
            price_connectivity: price_connectivity.as_deref(),
            investment_connectivity: investment_connectivity.as_deref(),
            like_name: &like_name,
            like_identifier: &like_identifier,
            exclude_historical: !input.include_historical.unwrap_or(false),
            like_search,
            order_name,
        },
    )
    .await?
    .into_iter()
    .map(|row| row.assets.try_into())
    .collect()
}

fn uses_fts(search: &str) -> bool {
    let mut terms = search.split_whitespace();
    terms.clone().next().is_some() && terms.all(|term| term.chars().count() >= 3)
}

fn fts_query(search: &str) -> String {
    search
        .split_whitespace()
        .map(|term| format!(r#""{}""#, term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::{all_assets, fts_query, uses_fts};
    use crate::{database::dbtest, schema::AssetsInput};

    #[test]
    fn chooses_literal_search_for_short_terms_and_escapes_fts_terms() {
        assert!(!uses_fts(""));
        assert!(!uses_fts("us gas"));
        assert!(uses_fts("blue bottle"));
        assert_eq!(
            fts_query(r#"bottle blue "reserve""#),
            r#""bottle" AND "blue" AND """reserve""""#
        );
    }

    #[tokio::test]
    async fn lists_user_created_assets_with_literal_and_fts_searches() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query("INSERT INTO assets (asset_type, identifier, name, classifier, user_created) VALUES ('CRYPTO', 'ETH', 'Ethereum blue chip', 'CRYPTOCURRENCY', 1), ('CRYPTO', 'SOL', 'Solana', 'CRYPTOCURRENCY', 1)")
            .execute(&pool)
            .await?;
        let input = |search| AssetsInput {
            asset_type: None,
            price_connectivity: None,
            include_historical: None,
            search,
            investment_connectivity: None,
        };

        assert_eq!(all_assets(&pool, input(Some("eth".to_owned()))).await?.len(), 1);
        assert_eq!(
            all_assets(&pool, input(Some("blue chip".to_owned()))).await?[0].identifier,
            "ETH"
        );
        Ok(())
    }
}
