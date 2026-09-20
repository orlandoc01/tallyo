use std::fmt::Display;

use async_graphql::{Context, Guard, Result};

use crate::{
    apierror::{ApiError, Code},
    auth::{Identity, Scope},
};

pub struct ScopeGuard {
    scope: &'static str,
}

impl ScopeGuard {
    pub fn new(scope: &'static str) -> Self {
        Self { scope }
    }
}

impl Guard for ScopeGuard {
    async fn check(&self, ctx: &Context<'_>) -> Result<()> {
        self.scope
            .parse::<Scope>()
            .map_err(|_| forbidden(self.scope))
            .and_then(|scope| require_scope(ctx.data_opt::<Identity>(), scope))
            .map(drop)
            .map_err(async_graphql::Error::new_with_source)
    }
}

pub fn require_scope(identity: Option<&Identity>, scope: Scope) -> std::result::Result<&Identity, ApiError> {
    identity
        .filter(|identity| identity.has_scope(scope))
        .ok_or_else(|| forbidden(scope))
}

fn forbidden(scope: impl Display) -> ApiError {
    ApiError::new(format!("forbidden: {scope} access required"), Code::Forbidden)
}

// Go's @requiresDynamicScope directive is a pass-through; the resolver body performs the check.
pub struct DynamicScopeGuard;

impl Guard for DynamicScopeGuard {
    async fn check(&self, _ctx: &Context<'_>) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use async_graphql::{Context, EmptyMutation, EmptySubscription, Guard, Object, Schema};

    use super::{DynamicScopeGuard, ScopeGuard};
    use crate::{
        apierror::ApiError,
        auth::{Identity, Scope},
    };

    struct Query;

    #[Object]
    impl Query {
        #[graphql(guard = "ScopeGuard::new(\"read:wealth\")")]
        async fn guarded(&self) -> bool {
            true
        }

        #[graphql(guard = "ScopeGuard::new(\"not:a-scope\")")]
        async fn unknown_scope(&self) -> bool {
            true
        }

        #[graphql(guard = "DynamicScopeGuard")]
        async fn dynamic(&self) -> bool {
            true
        }

        async fn denied_code(&self, ctx: &Context<'_>) -> String {
            match ScopeGuard::new("read:wealth").check(ctx).await {
                Ok(()) => "granted".to_owned(),
                Err(error) => error
                    .source
                    .as_ref()
                    .and_then(|source| source.downcast_ref::<ApiError>())
                    .map(|error| error.code.to_string())
                    .unwrap_or_default(),
            }
        }
    }

    async fn execute(query: &str, identity: Option<Identity>) -> async_graphql::Response {
        let mut schema = Schema::build(Query, EmptyMutation, EmptySubscription);
        if let Some(identity) = identity {
            schema = schema.data(identity);
        }
        schema.finish().execute(query).await
    }

    #[tokio::test]
    async fn scope_guard_requires_the_scope_on_the_request_identity() {
        let granted = execute("{ guarded }", Some(Identity::with_scopes(vec![Scope::ReadWealth]))).await;
        assert!(granted.is_ok(), "{:?}", granted.errors);
        assert_eq!(granted.data.to_string(), "{guarded: true}");

        for (query, identity) in [
            ("{ guarded }", Some(Identity::with_scopes(vec![Scope::ReadAccounts]))),
            ("{ guarded }", None),
        ] {
            let denied = execute(query, identity).await;
            assert_eq!(denied.errors.len(), 1, "{query}");
            assert_eq!(denied.errors[0].message, "forbidden: read:wealth access required");
        }
        let unknown = execute("{ unknownScope }", Some(Identity::with_scopes(vec![Scope::ReadWealth]))).await;
        assert_eq!(unknown.errors[0].message, "forbidden: not:a-scope access required");
    }

    #[tokio::test]
    async fn scope_guard_error_carries_the_forbidden_api_error() {
        let response = execute("{ deniedCode }", None).await;
        assert_eq!(response.data.to_string(), "{deniedCode: \"FORBIDDEN\"}");
    }

    #[tokio::test]
    async fn dynamic_scope_guard_passes_without_an_identity() {
        let response = execute("{ dynamic }", None).await;
        assert!(response.is_ok(), "{:?}", response.errors);
    }
}
