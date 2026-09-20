use anyhow::{Context, Result};

use crate::database::queries;

pub use crate::schema::PlaidCredential;

impl TryFrom<queries::ListPlaidCredentialsRow> for PlaidCredential {
    type Error = anyhow::Error;

    fn try_from(row: queries::ListPlaidCredentialsRow) -> Result<Self> {
        let environment = row
            .environment
            .to_uppercase()
            .parse()
            .with_context(|| format!("parse persisted Plaid environment {:?}", row.environment))?;
        Ok(Self {
            id: row.id as i32,
            client_id: row.client_id,
            environment,
            label: row.label,
            item_count: row.item_count as i32,
            created_at: row.created_at.into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        admin::PlaidCredential,
        database::{Timestamp, queries},
        schema::PlaidEnvironment,
    };

    #[test]
    fn maps_storage_environment_to_graphql_enum() {
        let credential = PlaidCredential::try_from(queries::ListPlaidCredentialsRow {
            id: 7,
            client_id: "client".to_owned(),
            environment: "production".to_owned(),
            label: Some("Primary".to_owned()),
            item_count: 2,
            created_at: Timestamp("2026-09-06T12:00:00Z".parse().unwrap()),
        })
        .unwrap();

        assert_eq!(credential.id, 7);
        assert_eq!(credential.environment, PlaidEnvironment::Production);
        assert_eq!(credential.item_count, 2);
    }

    #[test]
    fn rejects_invalid_storage_environment() {
        let error = PlaidCredential::try_from(queries::ListPlaidCredentialsRow {
            id: 7,
            client_id: "client".to_owned(),
            environment: "invalid".to_owned(),
            label: None,
            item_count: 0,
            created_at: Timestamp("2026-09-06T12:00:00Z".parse().unwrap()),
        })
        .unwrap_err();

        assert_eq!(error.to_string(), "parse persisted Plaid environment \"invalid\"");
    }
}
