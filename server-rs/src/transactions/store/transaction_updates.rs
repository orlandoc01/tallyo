use anyhow::Result;

use crate::{
    database::queries,
    ids::{GlobalId, GlobalIdType},
    schema::TransactionUpdates,
};

pub(super) struct UpdateParams {
    merchant_name: Option<Option<String>>,
    notes: Option<Option<String>>,
    is_recurring: Option<bool>,
    is_hidden: Option<bool>,
    category_id: Option<i64>,
    ids: Vec<i64>,
    pub(super) changed: bool,
}

impl UpdateParams {
    pub(super) fn query(&self) -> queries::UpdateTransactionFieldsByIDsParams<'_> {
        queries::UpdateTransactionFieldsByIDsParams {
            set_merchant_name: self.merchant_name.is_some(),
            merchant_name: self.merchant_name.as_ref().and_then(|value| value.as_deref()),
            set_notes: self.notes.is_some(),
            notes: self.notes.as_ref().and_then(|value| value.as_deref()),
            set_recurring: self.is_recurring.is_some(),
            is_recurring: self.is_recurring.unwrap_or(false),
            set_hidden: self.is_hidden.is_some(),
            is_hidden: self.is_hidden.unwrap_or(false),
            set_category: self.category_id.is_some(),
            category_id: self.category_id.unwrap_or_default(),
            ids: &self.ids,
        }
    }
}

pub(super) fn update_params(updates: &TransactionUpdates, ids: &[i64]) -> Result<UpdateParams> {
    let category_id = updates
        .category_id
        .as_ref()
        .map(|id| GlobalId::decode(id.as_str())?.i64_of_type(GlobalIdType::Category))
        .transpose()?;
    let merchant_name = updates.merchant_name.as_deref().map(trimmed);
    let notes = updates.notes.as_deref().map(trimmed);
    let changed = merchant_name.is_some()
        || notes.is_some()
        || updates.is_recurring.is_some()
        || updates.is_hidden.is_some()
        || category_id.is_some();
    Ok(UpdateParams {
        merchant_name,
        notes,
        is_recurring: updates.is_recurring,
        is_hidden: updates.is_hidden,
        category_id,
        ids: ids.to_vec(),
        changed,
    })
}

pub(super) async fn replace_transaction_tags(
    executor: &mut sqlx::SqliteConnection,
    transaction_ids: &[i64],
    tag_ids: &[i64],
) -> Result<()> {
    queries::delete_transaction_tags_by_transaction_ids(
        &mut *executor,
        queries::DeleteTransactionTagsByTransactionIDsParams { transaction_ids },
    )
    .await?;
    if !tag_ids.is_empty() {
        queries::add_transaction_tags_by_transaction_ids(
            &mut *executor,
            queries::AddTransactionTagsByTransactionIDsParams {
                tag_ids,
                transaction_ids,
            },
        )
        .await?;
    }
    Ok(())
}

fn trimmed(value: &str) -> Option<String> {
    (!value.trim().is_empty()).then(|| value.trim().to_owned())
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use async_graphql::ID;

    use super::*;
    use crate::ids::{GlobalId, GlobalIdType};

    #[test]
    fn normalizes_update_values_and_preserves_false_flags() -> Result<()> {
        let params = update_params(
            &TransactionUpdates {
                merchant_name: Some("  ".into()),
                notes: Some(" Note ".into()),
                is_recurring: Some(false),
                is_hidden: Some(false),
                category_id: Some(ID::from(GlobalId::new(GlobalIdType::Category, 7).encoded_string())),
                tag_ids: None,
            },
            &[1, 2],
        )?;
        let query = params.query();
        assert!(params.changed);
        assert!(query.set_merchant_name && query.merchant_name.is_none());
        assert_eq!(query.notes, Some("Note"));
        assert!(query.set_recurring && !query.is_recurring);
        assert!(query.set_hidden && !query.is_hidden);
        assert_eq!((query.category_id, query.ids), (7, &[1, 2][..]));
        assert!(
            update_params(
                &TransactionUpdates {
                    merchant_name: None,
                    notes: None,
                    is_recurring: None,
                    is_hidden: None,
                    category_id: Some(ID::from(GlobalId::new(GlobalIdType::Tag, 7).encoded_string(),)),
                    tag_ids: None,
                },
                &[],
            )
            .is_err()
        );
        Ok(())
    }
}
