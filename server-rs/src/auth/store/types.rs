use chrono::{DateTime, Utc};

pub use crate::database::queries::{
    AuthCodeRow as AuthCode, LoginSessionsRow as LoginSession, WebAuthnCredentialsByUserIdRow as WebAuthnCredential,
    WebAuthnRegistrationRow as WebAuthnRegistration,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OAuthClient {
    pub id: String,
    pub redirect_uris: Vec<String>,
    pub grant_types: Vec<String>,
    pub response_types: Vec<String>,
    pub scopes: Vec<String>,
    pub application_type: String,
    pub client_name: String,
    pub public: bool,
    pub preseeded: bool,
}

impl LoginSession {
    pub fn expires_at(&self) -> DateTime<Utc> {
        self.expires_at.into()
    }

    pub fn email_otp_expires_at(&self) -> Option<DateTime<Utc>> {
        self.email_otp_expires_at.map(Into::into)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EmailOtpUpdate {
    pub session_id: String,
    pub email: String,
    pub hashed_otp: String,
    pub hashed_magic_token: String,
    pub pkce_verifier: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OAuthToken {
    pub signature: String,
    pub client_id: String,
    pub subject: String,
    pub scopes: Vec<String>,
    pub expires_at: DateTime<Utc>,
    pub request_id: String,
    pub active: bool,
}
