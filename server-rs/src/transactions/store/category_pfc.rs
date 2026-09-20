use anyhow::{Result, anyhow};

use crate::{database::queries, pfc2};

pub(super) async fn replace_pfc2_mappings(
    executor: &mut sqlx::SqliteConnection,
    category_id: i64,
    codes: &[String],
) -> Result<()> {
    let codes = pfc2::normalize(codes);
    for code in &codes {
        anyhow::ensure!(pfc2::valid(code), "invalid Plaid PFC2 code {code:?}");
        if let Some(owner) = queries::pfc_2_mapped_category_name_opt(
            &mut *executor,
            queries::Pfc2MappedCategoryNameParams {
                plaid_detailed: code,
                category_id,
            },
        )
        .await?
        {
            return Err(anyhow!("PFC2 code {code} is already assigned to {}", owner.name));
        }
    }
    queries::delete_category_plaid_mappings(
        &mut *executor,
        queries::DeleteCategoryPlaidMappingsParams { category_id },
    )
    .await?;
    for code in &codes {
        queries::upsert_category_plaid_mapping(
            &mut *executor,
            queries::UpsertCategoryPlaidMappingParams {
                plaid_detailed: code,
                category_id,
            },
        )
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::*;
    use crate::{database, schema::CategoryKind, testutil::transactions::category};

    #[tokio::test]
    async fn replaces_valid_mappings_and_rejects_invalid_or_owned_codes() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let seeded = super::super::categories(&pool)
            .await?
            .into_iter()
            .find(|category| !category.plaid_pfc2_codes.is_empty())
            .expect("seeded PFC2 mapping");
        let code = seeded.plaid_pfc2_codes[0].clone();
        super::super::update_category(
            &pool,
            seeded.id,
            &seeded.name,
            &seeded.emoji,
            super::super::categories::group_id_of(&pool, seeded.id).await?,
            Some(&[]),
        )
        .await?;
        let first = category(&pool, "First", CategoryKind::Expense).await?;
        let second = category(&pool, "Second", CategoryKind::Expense).await?;
        let codes = [format!(" {code} "), code.clone()];
        database::with_tx(&pool, move |transaction| {
            Box::pin(async move { replace_pfc2_mappings(transaction, first.id, &codes).await })
        })
        .await?;
        let expected_duplicate = format!("PFC2 code {code} is already assigned to First");
        let duplicate_code = code.clone();
        assert_eq!(
            super::super::category_by_id(&pool, first.id)
                .await?
                .expect("category")
                .plaid_pfc2_codes,
            vec![code]
        );
        assert_eq!(
            database::with_tx(&pool, move |transaction| {
                Box::pin(async move { replace_pfc2_mappings(transaction, second.id, &[duplicate_code]).await })
            })
            .await
            .unwrap_err()
            .to_string(),
            expected_duplicate
        );
        assert_eq!(
            database::with_tx(&pool, move |transaction| {
                Box::pin(async move { replace_pfc2_mappings(transaction, first.id, &["not-a-code".to_owned()]).await })
            })
            .await
            .unwrap_err()
            .to_string(),
            "invalid Plaid PFC2 code \"NOT-A-CODE\""
        );
        Ok(())
    }
}
