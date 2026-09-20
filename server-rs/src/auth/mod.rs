mod cleanup;
mod config;
mod crypto;
mod email;
mod google;
mod identity;
mod middleware;
mod oauth;
mod roles;
mod service;
mod store;
mod webauthn;

pub use cleanup::run_cleanup;
pub use config::{
    AuthSettings, Config, DcrSettings, EmailSettings, FRONTEND_CLIENT_ID, GoogleEndpoints, GoogleSettings,
    MasterPasswordStatus, SmtpConfig, SmtpCredentials, WebAuthnRpConfig, WebAuthnSettings,
};
pub use crypto::{AccessTokenClaims, SigningKey, code_challenge, random_token, token_signature};
pub use email::{EmailMagicLink, EmailSend, EmailSender, EmailVerify, SmtpSender, generate_otp};
pub use google::GOOGLE_CALLBACK_TIMEOUT;
pub use google::GoogleClient;
pub use identity::{Identity, identity};
pub use middleware::{dev_cors, protect, protect_mcp, require_oauth};
pub use oauth::router;
pub use roles::{
    ALL_SCOPES, CLIENT_ALLOWED_SCOPES, Scope, expand_requested_scopes, granted_scopes_for_role, scopes_for_role,
};
pub use service::{Service, TimezoneCache};
pub use store::{
    AuthCode, ERR_ALREADY_USED, ERR_EMAIL_AUTH_NOT_ENABLED, ERR_EXPIRED, ERR_INVALID_CODE, ERR_INVALID_TOKEN,
    ERR_LOGIN_SESSION_ALREADY_AUTHENTICATED, ERR_LOGIN_SESSION_NOT_FOUND_OR_EXPIRED, ERR_OTP_COOLDOWN,
    ERR_TOO_MANY_ATTEMPTS, EmailOtpUpdate, LoginSession, OAuthClient, OAuthToken, Store, User, WebAuthnCredential,
    WebAuthnRegistration,
};
