use std::{sync::Arc, time::Duration};

use anyhow::{Context, Result};
use chrono::Utc;
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor, transport::smtp::authentication::Credentials,
};

use crate::schema::Role;

use super::{
    ERR_EMAIL_AUTH_NOT_ENABLED, ERR_LOGIN_SESSION_ALREADY_AUTHENTICATED, ERR_LOGIN_SESSION_NOT_FOUND_OR_EXPIRED,
    ERR_OTP_COOLDOWN, EmailOtpUpdate, LoginSession, Service, SmtpConfig, token_signature,
};

const OTP_LIFETIME: Duration = Duration::from_secs(10 * 60);
const OTP_COOLDOWN: Duration = Duration::from_secs(60);
const SMTP_TIMEOUT: Duration = Duration::from_secs(30);

pub enum EmailSender {
    Smtp(SmtpSender),
    DevLog,
}

pub struct SmtpSender {
    host: String,
    port: u16,
    from: String,
    credentials: Option<Credentials>,
    pub timeout: Duration,
}

impl EmailSender {
    pub async fn send(&self, to: &str, subject: &str, body: String) -> Result<()> {
        match self {
            Self::Smtp(sender) => sender.send(to, subject, body).await,
            Self::DevLog => {
                tracing::info!(%to, %subject, %body, "email OTP (no SMTP configured; dev mode only)");
                Ok(())
            }
        }
    }
}

impl SmtpSender {
    async fn send(&self, to: &str, subject: &str, body: String) -> Result<()> {
        let email = Message::builder()
            .from(self.from.parse().context("parse smtp from address")?)
            .to(to.parse().context("parse smtp recipient")?)
            .subject(subject)
            .body(body)
            .context("build smtp message")?;
        let builder = match &self.credentials {
            None => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&self.host).port(self.port),
            Some(credentials) => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&self.host)
                .context("configure smtp STARTTLS")?
                .port(self.port)
                .credentials(credentials.clone()),
        };
        tokio::time::timeout(self.timeout, builder.build().send(email))
            .await
            .context("smtp timeout")?
            .context("send smtp message")?;
        Ok(())
    }
}

pub(super) fn new_sender(settings: &super::EmailSettings) -> Arc<EmailSender> {
    Arc::new(
        settings
            .smtp
            .as_ref()
            .map_or(EmailSender::DevLog, |smtp| EmailSender::Smtp(smtp_sender(smtp))),
    )
}

fn smtp_sender(config: &SmtpConfig) -> SmtpSender {
    SmtpSender {
        host: config.host.clone(),
        port: config.port,
        from: config.from.clone(),
        credentials: config
            .credentials
            .as_ref()
            .map(|credentials| Credentials::new(credentials.username.clone(), credentials.password.clone())),
        timeout: SMTP_TIMEOUT,
    }
}

#[derive(Clone, Debug)]
pub struct EmailSend {
    pub login_session_id: String,
    pub email: String,
    pub code_verifier: String,
}
#[derive(Clone, Debug)]
pub struct EmailVerify {
    pub login_session_id: String,
    pub email: String,
    pub code: String,
}
#[derive(Clone, Debug)]
pub struct EmailMagicLink {
    pub token: String,
    pub session_id: String,
    pub email: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EmailSendResult {
    pub sent: bool,
    pub message: Option<String>,
}

impl Service {
    pub async fn send_email_code(&self, request: EmailSend) -> Result<EmailSendResult> {
        anyhow::ensure!(self.email_enabled(), ERR_EMAIL_AUTH_NOT_ENABLED);
        let email = normalize_email(&request.email);
        if !self.store().is_email_allowed(&email).await? {
            return Ok(EmailSendResult {
                sent: true,
                message: Some("If that address is registered, a code has been sent.".to_owned()),
            });
        }
        let session = self
            .store()
            .login_session_by_id(&request.login_session_id)
            .await?
            .context(ERR_LOGIN_SESSION_NOT_FOUND_OR_EXPIRED)?;
        anyhow::ensure!(
            session.expires_at() > Utc::now(),
            ERR_LOGIN_SESSION_NOT_FOUND_OR_EXPIRED
        );
        anyhow::ensure!(!session.authenticated, ERR_LOGIN_SESSION_ALREADY_AUTHENTICATED);
        let cooldown_boundary = Utc::now() + chrono::Duration::from_std(OTP_LIFETIME - OTP_COOLDOWN)?;
        anyhow::ensure!(
            session
                .email_otp_expires_at()
                .is_none_or(|expires_at| expires_at <= cooldown_boundary),
            ERR_OTP_COOLDOWN
        );
        let code = generate_otp();
        let magic_token = super::random_token(32);
        let expires_at = Utc::now() + chrono::Duration::from_std(OTP_LIFETIME)?;
        self.store()
            .save_email_otp(&EmailOtpUpdate {
                session_id: request.login_session_id.clone(),
                email: email.clone(),
                hashed_otp: token_signature(&code),
                hashed_magic_token: token_signature(&magic_token),
                pkce_verifier: request.code_verifier,
                expires_at,
            })
            .await?;
        let magic_link = magic_link_url(
            &self.issuer_url(),
            &magic_token,
            &request.login_session_id,
            &email,
            false,
        );
        self.email_sender().send(&email, "Tallyo Email Login", format!("Your Tallyo sign-in code is: {code}\n\nOr, click this link to sign in instantly:\n{magic_link}\n\nBoth expire in 10 minutes.\n\nIf you didn't request this, you can safely ignore this email.")).await?;
        Ok(EmailSendResult {
            sent: true,
            message: None,
        })
    }

    pub async fn verify_email_code(&self, request: EmailVerify) -> Result<LoginSession> {
        self.store()
            .verify_email_otp(
                &request.login_session_id,
                &normalize_email(&request.email),
                &request.code,
            )
            .await
    }
    pub async fn verify_email_magic_link(&self, request: EmailMagicLink) -> Result<LoginSession> {
        self.store()
            .verify_email_magic_token(&request.session_id, &normalize_email(&request.email), &request.token)
            .await
    }
}

impl Service {
    pub async fn send_invitation(&self, email: &str, role: Role, invited_by: &str) -> Result<()> {
        if !self.oauth_enabled() {
            return Ok(());
        }
        let (link, _) = self
            .build_invite_session(email, role, Duration::from_secs(24 * 60 * 60), "")
            .await?;
        self.email_sender().send(email, "You're invited to Tallyo", format!("You've been invited to Tallyo by {invited_by}.\n\nClick the link below to sign in — it expires in 24 hours:\n{link}\n\nIf you didn't expect this invitation, you can safely ignore this email.")).await.context("send invitation email")
    }

    pub async fn create_invite_link(&self, email: &str, role: Role) -> Result<(String, chrono::DateTime<Utc>)> {
        anyhow::ensure!(self.oauth_enabled(), "invitations are not configured");
        self.build_invite_session(email, role, Duration::from_secs(15 * 60), "passkey")
            .await
    }
}

pub fn generate_otp() -> String {
    rand::random_range(100000..=999999).to_string()
}

pub(super) fn magic_link_url(issuer: &str, token: &str, session_id: &str, email: &str, onboarding: bool) -> String {
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    query
        .append_pair("token", token)
        .append_pair("session_id", session_id)
        .append_pair("email", email);
    if onboarding {
        query.append_pair("onboarding", "passkey");
    }
    format!("{issuer}/auth/email/magic?{}", query.finish())
}
fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::{
        io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
        net::TcpListener,
    };

    use super::{EmailSender, SmtpSender, magic_link_url};

    async fn smtp_server() -> (u16, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (reader, mut writer) = stream.into_split();
            let mut reader = BufReader::new(reader);
            let mut line = String::new();
            writer.write_all(b"220 smtp.test\r\n").await.unwrap();
            reader.read_line(&mut line).await.unwrap();
            writer.write_all(b"250-smtp.test\r\n250 OK\r\n").await.unwrap();
            line.clear();
            reader.read_line(&mut line).await.unwrap();
            writer.write_all(b"250 OK\r\n").await.unwrap();
            line.clear();
            reader.read_line(&mut line).await.unwrap();
            let recipient = line.clone();
            writer.write_all(b"250 OK\r\n").await.unwrap();
            line.clear();
            reader.read_line(&mut line).await.unwrap();
            writer.write_all(b"354 send data\r\n").await.unwrap();
            loop {
                line.clear();
                reader.read_line(&mut line).await.unwrap();
                if line == ".\r\n" {
                    break;
                }
            }
            writer.write_all(b"250 accepted\r\n").await.unwrap();
            line.clear();
            reader.read_line(&mut line).await.unwrap();
            writer.write_all(b"221 bye\r\n").await.unwrap();
            recipient
        });
        (port, server)
    }

    #[test]
    fn encodes_magic_link_query_values() {
        assert!(
            magic_link_url(
                "https://tallyo.test",
                "token",
                "session",
                "person+tag@example.com",
                false,
            )
            .contains("email=person%2Btag%40example.com")
        );
    }

    #[tokio::test]
    async fn selects_development_logging_without_smtp() {
        let sender = super::new_sender(&super::super::EmailSettings::default());
        assert!(matches!(sender.as_ref(), EmailSender::DevLog));
        sender
            .send("to@example.com", "subject", "body".to_owned())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn sends_plain_smtp_and_requires_starttls_for_credentials() {
        let (port, server) = smtp_server().await;
        let sender = SmtpSender {
            host: "127.0.0.1".to_owned(),
            port,
            from: "from@example.com".to_owned(),
            credentials: None,
            timeout: Duration::from_secs(1),
        };
        EmailSender::Smtp(sender)
            .send("to@example.com", "subject", "body".to_owned())
            .await
            .unwrap();
        assert!(server.await.unwrap().contains("to@example.com"));

        let (port, _server) = smtp_server().await;
        let sender = SmtpSender {
            host: "127.0.0.1".to_owned(),
            port,
            from: "from@example.com".to_owned(),
            credentials: Some(lettre::transport::smtp::authentication::Credentials::new(
                "user".to_owned(),
                "password".to_owned(),
            )),
            timeout: Duration::from_secs(1),
        };
        assert!(
            EmailSender::Smtp(sender)
                .send("to@example.com", "subject", "body".to_owned())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn times_out_when_smtp_never_speaks() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _connection = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(1)).await;
        });
        let sender = SmtpSender {
            host: "127.0.0.1".to_owned(),
            port,
            from: "from@example.com".to_owned(),
            credentials: None,
            timeout: Duration::from_millis(10),
        };
        assert!(
            EmailSender::Smtp(sender)
                .send("to@example.com", "subject", "body".to_owned())
                .await
                .unwrap_err()
                .to_string()
                .contains("smtp timeout")
        );
    }
}
