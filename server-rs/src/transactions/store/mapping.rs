use crate::{
    accounts::Account,
    database::queries,
    schema::CategoryKind,
    transactions::{Category, Rule, Tag, Transaction},
};

pub(crate) fn category_from_row(row: queries::CategoryRows) -> Category {
    Category {
        id: row.cat_id,
        name: row.cat_name,
        emoji: row.cat_emoji,
        group_name: row.group_name,
        group_emoji: row.group_emoji,
        kind: row
            .group_kind
            .parse()
            .expect("category group kind is database-constrained"),
        sort_order: row.sort_order as i32,
        plaid_pfc2_codes: split_csv(&row.plaid_pfc_2_codes),
    }
}

impl From<queries::ListCategoriesRow> for Category {
    fn from(row: queries::ListCategoriesRow) -> Self {
        category_from_row(queries::CategoryRows {
            cat_id: row.cat_id,
            cat_name: row.cat_name,
            cat_emoji: row.cat_emoji,
            group_name: row.group_name,
            group_emoji: row.group_emoji,
            group_kind: row.group_kind,
            sort_order: row.sort_order,
            group_id: row.group_id,
            group_sort_order: row.group_sort_order,
            plaid_pfc_2_codes: row.plaid_pfc_2_codes,
        })
    }
}

impl From<queries::TransactionRecordsRow> for Transaction {
    fn from(row: queries::TransactionRecordsRow) -> Self {
        Self {
            id: row.id,
            account: Account::from((row.accounts, row.owner_name)),
            amount: row.amount_cents,
            datetime: row.datetime.into(),
            posted_datetime: row.posted_datetime.into(),
            merchant_name: row.merchant_name,
            original_name: row.original_name,
            logo_url: row.logo_url,
            category: category_from_row(row.category_rows),
            is_recurring: row.is_recurring,
            is_reviewed: row.is_reviewed,
            notes: row.notes,
            plaid_category: row.plaid_category,
            pending: row.pending,
            is_hidden: row.is_hidden,
            created_at: row.created_at.into(),
            updated_at: row.updated_at.into(),
        }
    }
}

pub(super) fn rule_from_row(mut row: queries::ListRulesRow) -> Rule {
    let category = category_from_rule_row(&mut row);
    Rule {
        id: row.rules.id,
        merchant_pattern: (!row.rules.merchant_pattern.is_empty()).then_some(row.rules.merchant_pattern),
        original_pattern: (!row.rules.original_pattern.is_empty()).then_some(row.rules.original_pattern),
        merchant_name: row.rules.merchant_name,
        category,
        should_hide: row.rules.should_hide,
        should_be_recurring: row.rules.should_be_recurring,
        amount_min: row.rules.amount_min_cents,
        amount_max: row.rules.amount_max_cents,
        priority: row.rules.priority as i32,
        created_at: row.rules.created_at.into(),
    }
}

fn category_from_rule_row(row: &mut queries::ListRulesRow) -> Option<Category> {
    Some(category_from_row(queries::CategoryRows {
        cat_id: row.cat_id?,
        cat_name: row.cat_name.take()?,
        cat_emoji: row.cat_emoji.take()?,
        group_name: row.group_name.take()?,
        group_emoji: row.group_emoji.take()?,
        group_kind: row.group_kind.take()?,
        sort_order: row.sort_order?,
        group_id: 0,
        group_sort_order: 0,
        plaid_pfc_2_codes: row.plaid_pfc_2_codes.take()?,
    }))
}

pub(super) fn tag_from_fields(id: i64, name: String, color: String, transaction_count: i64) -> Tag {
    Tag {
        id,
        name,
        color,
        transaction_count: transaction_count as i32,
    }
}

pub(super) fn tag_from_row(row: queries::ListTagsRow) -> Tag {
    tag_from_fields(row.id, row.name, row.color, row.transaction_count)
}

pub(super) fn split_csv(value: &str) -> Vec<String> {
    value
        .split(',')
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

pub(super) fn category_kind(value: &str) -> CategoryKind {
    value.parse().expect("category group kind is database-constrained")
}
