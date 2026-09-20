use axum::http::Extensions;

use crate::utils::timezone::FALLBACK_TIMEZONE;

use super::roles::Scope;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Identity {
    pub subject: Option<String>,
    pub scopes: Vec<Scope>,
    pub timezone: String,
}

impl Identity {
    pub fn with_scopes(scopes: Vec<Scope>) -> Self {
        Self {
            subject: None,
            scopes,
            timezone: FALLBACK_TIMEZONE.to_owned(),
        }
    }

    pub fn has_scope(&self, scope: Scope) -> bool {
        self.scopes.contains(&scope)
    }
}

pub fn identity(extensions: &Extensions) -> Option<&Identity> {
    extensions.get()
}

#[cfg(test)]
mod tests {
    use axum::http::Extensions;

    use super::{Identity, identity};
    use crate::auth::Scope;

    #[test]
    fn keeps_scopes_in_request_extensions() {
        let value = Identity::with_scopes(vec![Scope::ReadAccounts]);
        let mut extensions = Extensions::new();
        extensions.insert(value);
        assert!(identity(&extensions).unwrap().has_scope(Scope::ReadAccounts));
    }
}
