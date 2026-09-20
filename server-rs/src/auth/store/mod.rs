use anyhow::Result;
use sqlx::SqlitePool;

mod clients;
mod sessions;
mod tokens;
mod types;
mod users;
mod webauthn;

pub use crate::schema::User;
pub use types::{
    AuthCode, EmailOtpUpdate, LoginSession, OAuthClient, OAuthToken, WebAuthnCredential, WebAuthnRegistration,
};

pub const ERR_INVALID_CODE: &str = "invalid_code";
pub const ERR_INVALID_TOKEN: &str = "invalid_token";
pub const ERR_TOO_MANY_ATTEMPTS: &str = "too_many_attempts";
pub const ERR_EXPIRED: &str = "expired";
pub const ERR_ALREADY_USED: &str = "already_used";
pub const ERR_LOGIN_SESSION_NOT_FOUND_OR_EXPIRED: &str = "login session not found or expired";
pub const ERR_LOGIN_SESSION_ALREADY_AUTHENTICATED: &str = "login session already authenticated";
pub const ERR_OTP_COOLDOWN: &str = "please wait before requesting a new code";
pub const ERR_EMAIL_AUTH_NOT_ENABLED: &str = "email auth is not enabled";

#[derive(Clone)]
pub struct Store {
    pub(super) pool: SqlitePool,
}

impl Store {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

pub(super) fn affected(rows: u64, operation: &str) -> Result<()> {
    anyhow::ensure!(rows == 1, "{operation}: not found");
    Ok(())
}

pub(crate) fn split_scopes(value: &str) -> Vec<String> {
    value.split_whitespace().map(ToOwned::to_owned).collect()
}
