use std::time::Duration;

use anyhow::{Context, Result};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::Utc;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use p256::{
    SecretKey,
    elliptic_curve::Generate,
    pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding},
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::roles::Scope;

#[derive(Clone, Debug)]
pub struct SigningKey {
    private_pem: String,
    public_pem: String,
    encoding: EncodingKey,
    decoding: DecodingKey,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccessTokenClaims {
    pub iss: String,
    pub sub: String,
    pub aud: Vec<String>,
    pub exp: i64,
    pub iat: i64,
    pub jti: String,
    pub scope: String,
    pub email: String,
    pub locale: LocaleClaim,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocaleClaim {
    pub timezone: String,
}

impl SigningKey {
    pub fn generate() -> Result<Self> {
        let private = SecretKey::generate();
        let private_pem = private
            .to_sec1_pem(LineEnding::LF)
            .context("encode private signing key")?;
        let public_pem = private
            .public_key()
            .to_public_key_pem(LineEnding::LF)
            .context("encode public signing key")?;
        Self::parse(&private_pem, &public_pem)
    }

    pub fn parse(private_pem: &str, public_pem: &str) -> Result<Self> {
        let private = SecretKey::from_sec1_pem(private_pem).context("parse private signing key")?;
        let private_pkcs8 = private
            .to_pkcs8_pem(LineEnding::LF)
            .context("encode private signing key")?;
        Ok(Self {
            private_pem: private_pem.to_owned(),
            public_pem: public_pem.to_owned(),
            encoding: EncodingKey::from_ec_pem(private_pkcs8.as_bytes()).context("parse private signing key")?,
            decoding: DecodingKey::from_ec_pem(public_pem.as_bytes()).context("parse public signing key")?,
        })
    }

    pub fn private_pem(&self) -> &str {
        &self.private_pem
    }
    pub fn public_pem(&self) -> &str {
        &self.public_pem
    }

    pub fn mint(
        &self,
        issuer: &str,
        subject: &str,
        scopes: &[Scope],
        timezone: &str,
        lifetime: Duration,
    ) -> Result<String> {
        let now = Utc::now();
        let claims = AccessTokenClaims {
            iss: issuer.to_owned(),
            sub: subject.to_owned(),
            aud: vec![issuer.to_owned()],
            exp: (now + chrono::Duration::from_std(lifetime)?).timestamp(),
            iat: now.timestamp(),
            jti: random_token(32),
            scope: scopes.iter().map(ToString::to_string).collect::<Vec<_>>().join(" "),
            email: subject.to_owned(),
            locale: LocaleClaim {
                timezone: timezone.to_owned(),
            },
        };
        let mut header = Header::new(Algorithm::ES256);
        header.typ = Some("JWT".to_owned());
        encode(&header, &claims, &self.encoding).context("sign access token")
    }

    pub fn verify(&self, token: &str, issuer: &str) -> Result<AccessTokenClaims> {
        let mut validation = Validation::new(Algorithm::ES256);
        validation.leeway = 0;
        validation.set_issuer(&[issuer]);
        validation.set_audience(&[issuer]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        let claims = decode::<AccessTokenClaims>(token, &self.decoding, &validation)
            .context("verify access token")?
            .claims;
        anyhow::ensure!(!claims.sub.is_empty(), "invalid token");
        Ok(claims)
    }
}

pub fn random_token(bytes: usize) -> String {
    let mut token = vec![0; bytes];
    rand::rng().fill(&mut token[..]);
    URL_SAFE_NO_PAD.encode(token)
}

pub fn token_signature(token: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(token.as_bytes()))
}

pub fn code_challenge(verifier: &str) -> String {
    token_signature(verifier)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{SigningKey, code_challenge, random_token, token_signature};
    use crate::auth::Scope;

    #[test]
    fn signs_es256_tokens_with_go_compatible_pem() {
        let key = SigningKey::generate().unwrap();
        assert!(key.private_pem().contains("BEGIN EC PRIVATE KEY"));
        assert!(key.public_pem().contains("BEGIN PUBLIC KEY"));
        let token = key
            .mint(
                "https://tallyo.test",
                "person@example.com",
                &[Scope::ReadAccounts],
                "UTC",
                Duration::from_secs(60),
            )
            .unwrap();
        assert_eq!(
            key.verify(&token, "https://tallyo.test").unwrap().sub,
            "person@example.com"
        );
    }

    #[test]
    fn signs_and_verifies_a_go_generated_sec1_key_pair() {
        const PRIVATE_KEY: &str = "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEILhs17ldLdaV3umkq+zvltVbxcOw/JV+dOsCUWlWZQD6oAoGCCqGSM49\nAwEHoUQDQgAEM8cdJm+0QOjb/190Oc13fXfTkPaO/IiPqO9b+lzp9R1IUGz6WW8t\njVhounPXOn3Stggaf5Q791sGUsjPXFjGAw==\n-----END EC PRIVATE KEY-----\n"; // gitleaks:allow
        const PUBLIC_KEY: &str = "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEM8cdJm+0QOjb/190Oc13fXfTkPaO\n/IiPqO9b+lzp9R1IUGz6WW8tjVhounPXOn3Stggaf5Q791sGUsjPXFjGAw==\n-----END PUBLIC KEY-----\n";
        let key = SigningKey::parse(PRIVATE_KEY, PUBLIC_KEY).unwrap();
        let token = key
            .mint(
                "https://tallyo.test",
                "person@example.com",
                &[Scope::ReadAccounts],
                "UTC",
                Duration::from_secs(60),
            )
            .unwrap();
        assert_eq!(
            key.verify(&token, "https://tallyo.test").unwrap().aud,
            ["https://tallyo.test"]
        );
    }

    #[test]
    fn generates_url_safe_opaque_tokens_and_s256_challenges() {
        let token = random_token(32);
        assert!(!token.contains('='));
        assert_eq!(code_challenge("verifier"), token_signature("verifier"));
    }
}
