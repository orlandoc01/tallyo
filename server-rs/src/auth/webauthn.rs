use std::time::Duration;

use anyhow::{Context, Result};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;
use webauthn_rs_core::{
    WebauthnCore,
    proto::{
        AttestationConveyancePreference, AttestationFormat, AuthenticationState, AuthenticatorAttachment,
        AuthenticatorTransport, COSEKey, CreationChallengeResponse, Credential, PublicKeyCredential,
        RegisterPublicKeyCredential, RegistrationState, RequestChallengeResponse, UserVerificationPolicy,
    },
};

use super::{Service, WebAuthnCredential, WebAuthnRegistration, WebAuthnRpConfig};

const CEREMONY_LIFETIME: ChronoDuration = ChronoDuration::minutes(10);
const AUTHENTICATOR_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug)]
pub(super) enum WebAuthnError {
    Expired,
    Rejected(anyhow::Error),
    Internal(anyhow::Error),
}

impl From<anyhow::Error> for WebAuthnError {
    fn from(error: anyhow::Error) -> Self {
        Self::Internal(error)
    }
}

pub(super) fn new_core(rp: &WebAuthnRpConfig) -> Result<WebauthnCore> {
    let origins = rp
        .rp_origins
        .iter()
        .map(|origin| Url::parse(origin).with_context(|| format!("parse webauthn origin {origin:?}")))
        .collect::<Result<Vec<_>>>()?;
    Ok(WebauthnCore::new_unsafe_experts_only(
        &rp.rp_display_name,
        &rp.rp_id,
        origins,
        AUTHENTICATOR_TIMEOUT,
        None,
        None,
    ))
}

pub(super) async fn begin_registration(
    service: &Service,
    user_id: i64,
    name: String,
) -> Result<CreationChallengeResponse, WebAuthnError> {
    let user = webauthn_user_by_id(service, user_id)
        .await?
        .context("lookup user email")?;
    let core = webauthn_or_error(service)?;
    let builder = core
        .new_challenge_register_builder(user.id.to_string().as_bytes(), &user.email, &user.email)
        .map_err(anyhow::Error::from)?
        .attestation(AttestationConveyancePreference::None)
        .user_verification_policy(UserVerificationPolicy::Required)
        .require_resident_key(true)
        .authenticator_attachment(Some(AuthenticatorAttachment::Platform))
        .exclude_credentials(Some(
            user.credentials
                .iter()
                .map(|credential| credential.core.cred_id.clone())
                .collect(),
        ));
    let (options, state) = core.generate_challenge_register(builder).map_err(anyhow::Error::from)?;
    service
        .store()
        .save_webauthn_registration(&WebAuthnRegistration {
            user_id: user.id,
            name,
            session: serde_json::to_string(&state).context("encode webauthn registration")?,
            expires_at: (Utc::now() + CEREMONY_LIFETIME).into(),
        })
        .await?;
    Ok(options)
}

pub(super) async fn finish_registration(
    service: &Service,
    user_id: i64,
    response: RegistrationResponse,
) -> Result<WebAuthnCredential, WebAuthnError> {
    let user = webauthn_user_by_id(service, user_id)
        .await?
        .context("lookup user email")?;
    let registration = service
        .store()
        .webauthn_registration(user.id)
        .await?
        .filter(|registration| DateTime::<Utc>::from(registration.expires_at) > Utc::now())
        .ok_or(WebAuthnError::Expired)?;
    let state: RegistrationState = serde_json::from_str(&registration.session).context("load registration session")?;
    let credential = webauthn_or_error(service)?
        .register_credential(&response.credential, &state, None)
        .map_err(|error| WebAuthnError::Rejected(error.into()))?;
    let stored = StoredCredential::from_registration(&credential, response).map_err(WebAuthnError::Rejected)?;
    let id = credential_id(&stored.id);
    service
        .store()
        .consume_webauthn_registration(&WebAuthnCredential {
            id: id.clone(),
            user_id: user.id,
            name: registration.name,
            credential: serde_json::to_string(&stored).context("encode webauthn credential")?,
            created_at: Utc::now().into(),
            last_used_at: None,
        })
        .await?;
    Ok(service
        .store()
        .webauthn_credentials_by_user_id(user.id)
        .await?
        .into_iter()
        .find(|credential| credential.id == id)
        .context("load saved webauthn credential")?)
}

pub(super) async fn begin_login(
    service: &Service,
    login_session_id: &str,
) -> Result<RequestChallengeResponse, WebAuthnError> {
    active_login_session(service, login_session_id).await?;
    let core = webauthn_or_error(service)?;
    let builder = core
        .new_challenge_authenticate_builder(Vec::new(), Some(UserVerificationPolicy::Required))
        .map_err(anyhow::Error::from)?;
    let (options, state) = core
        .generate_challenge_authenticate(builder)
        .map_err(anyhow::Error::from)?;
    service
        .store()
        .save_login_session_webauthn(
            login_session_id,
            &serde_json::to_string(&state).context("encode webauthn login")?,
        )
        .await?;
    Ok(options)
}

pub(super) async fn finish_login(
    service: &Service,
    login_session_id: &str,
    assertion: PublicKeyCredential,
) -> Result<String, WebAuthnError> {
    let session = active_login_session(service, login_session_id).await?;
    if session.webauthn_session.is_empty() {
        return Err(WebAuthnError::Expired);
    }
    let mut state: AuthenticationState =
        serde_json::from_str(&session.webauthn_session).context("load webauthn login")?;
    let user_id = assertion
        .get_user_unique_id()
        .context("unknown credential")
        .and_then(|handle| {
            std::str::from_utf8(handle)
                .context("unknown credential")
                .and_then(|value| value.parse::<i64>().context("unknown credential"))
        })
        .map_err(WebAuthnError::Rejected)?;
    let user = webauthn_user_by_id(service, user_id)
        .await?
        .ok_or_else(|| WebAuthnError::Rejected(anyhow::anyhow!("unknown credential")))?;
    // ponytail: zero the core counter to match Go; reject regressions here for stricter clone protection.
    state.set_allowed_credentials(
        user.credentials
            .iter()
            .map(|credential| Credential {
                counter: 0,
                ..credential.core.clone()
            })
            .collect(),
    );
    let result = webauthn_or_error(service)?
        .authenticate_credential(&assertion, &state)
        .map_err(|error| WebAuthnError::Rejected(error.into()))?;
    let credential_bytes = result.cred_id().as_slice();
    let credential = user
        .credentials
        .iter()
        .find(|credential| credential.stored.id == credential_bytes)
        .context("unknown credential")
        .map_err(WebAuthnError::Rejected)?;
    let mut stored = credential.stored.clone();
    stored.update_after_authentication(
        result.counter(),
        result.user_verified(),
        result.backup_eligible(),
        result.backup_state(),
    );
    if stored.authenticator.clone_warning {
        tracing::warn!(
            credential_id = credential_id(&stored.id),
            "webauthn credential clone warning"
        );
    }
    service
        .store()
        .update_webauthn_credential(
            &credential.row.id,
            &serde_json::to_string(&stored).context("encode webauthn credential")?,
            Utc::now(),
        )
        .await?;
    service
        .store()
        .mark_login_session_authenticated(login_session_id, &user.email)
        .await?;
    Ok(format!(
        "{}/authorize?session_id={login_session_id}",
        service.issuer_url()
    ))
}

fn webauthn_or_error(service: &Service) -> Result<WebauthnCore> {
    service.webauthn_core().context("webauthn is not enabled")
}

async fn active_login_session(service: &Service, login_session_id: &str) -> Result<super::LoginSession, WebAuthnError> {
    service
        .store()
        .login_session_by_id(login_session_id)
        .await?
        .filter(|session| !session.authenticated && session.expires_at() > Utc::now())
        .ok_or(WebAuthnError::Expired)
}

async fn webauthn_user_by_id(service: &Service, id: i64) -> Result<Option<WebAuthnUser>> {
    let Some(email) = service.store().user_email_by_id(id).await? else {
        return Ok(None);
    };
    let credentials = service
        .store()
        .webauthn_credentials_by_user_id(id)
        .await?
        .into_iter()
        .map(StoredUserCredential::try_from)
        .collect::<Result<Vec<_>>>()?;
    Ok(Some(WebAuthnUser { id, email, credentials }))
}

struct WebAuthnUser {
    id: i64,
    email: String,
    credentials: Vec<StoredUserCredential>,
}

struct StoredUserCredential {
    row: WebAuthnCredential,
    stored: StoredCredential,
    core: Credential,
}

impl TryFrom<WebAuthnCredential> for StoredUserCredential {
    type Error = anyhow::Error;

    fn try_from(row: WebAuthnCredential) -> Result<Self> {
        let stored = StoredCredential::try_from(row.credential.as_str()).context("decode webauthn credential")?;
        let core = Credential::try_from(&stored).context("decode webauthn credential")?;
        Ok(Self { row, stored, core })
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
struct StoredCredential {
    #[serde(with = "standard_base64")]
    id: Vec<u8>,
    #[serde(rename = "publicKey", with = "standard_base64")]
    public_key: Vec<u8>,
    #[serde(default, rename = "attestationType", skip_serializing_if = "String::is_empty")]
    attestation_type: String,
    #[serde(default, rename = "attestationFormat", skip_serializing_if = "String::is_empty")]
    attestation_format: String,
    #[serde(default, rename = "transport", skip_serializing_if = "Vec::is_empty")]
    transport: Vec<String>,
    #[serde(default)]
    flags: StoredCredentialFlags,
    authenticator: StoredAuthenticator,
    attestation: StoredAttestation,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredCredentialFlags {
    user_present: bool,
    user_verified: bool,
    backup_eligible: bool,
    backup_state: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredAuthenticator {
    #[serde(
        default,
        rename = "AAGUID",
        skip_serializing_if = "Vec::is_empty",
        with = "standard_base64"
    )]
    aaguid: Vec<u8>,
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    sign_count: u32,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    clone_warning: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    attachment: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredAttestation {
    #[serde(
        default,
        rename = "clientDataJSON",
        skip_serializing_if = "Vec::is_empty",
        with = "standard_base64"
    )]
    client_data_json: Vec<u8>,
    #[serde(default, skip_serializing_if = "Vec::is_empty", with = "standard_base64")]
    client_data_hash: Vec<u8>,
    #[serde(default, skip_serializing_if = "Vec::is_empty", with = "standard_base64")]
    authenticator_data: Vec<u8>,
    #[serde(default, skip_serializing_if = "is_zero")]
    public_key_algorithm: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty", with = "standard_base64")]
    object: Vec<u8>,
}

impl TryFrom<&str> for StoredCredential {
    type Error = anyhow::Error;

    fn try_from(value: &str) -> Result<Self> {
        let json: serde_json::Value = serde_json::from_str(value)?;
        anyhow::ensure!(
            json.get("publicKey").is_some(),
            "unsupported webauthn credential format"
        );
        Ok(serde_json::from_value(json)?)
    }
}

impl TryFrom<&StoredCredential> for Credential {
    type Error = anyhow::Error;

    fn try_from(stored: &StoredCredential) -> Result<Self> {
        let value = serde_cbor_2::from_slice(&stored.public_key).context("decode webauthn public key")?;
        Ok(Self {
            cred_id: stored.id.clone().into(),
            cred: COSEKey::try_from(&value).context("decode webauthn public key")?,
            counter: stored.authenticator.sign_count,
            transports: (!stored.transport.is_empty()).then(|| {
                stored
                    .transport
                    .iter()
                    .filter_map(|transport| transport.parse::<AuthenticatorTransport>().ok())
                    .collect()
            }),
            user_verified: stored.flags.user_verified,
            backup_eligible: stored.flags.backup_eligible,
            backup_state: stored.flags.backup_state,
            registration_policy: UserVerificationPolicy::Required,
            extensions: Default::default(),
            attestation: Default::default(),
            attestation_format: AttestationFormat::None,
        })
    }
}

impl StoredCredential {
    fn from_registration(credential: &Credential, response: RegistrationResponse) -> Result<Self> {
        let RegistrationAttestation {
            fmt,
            authenticator_data,
        } = serde_cbor_2::from_slice(response.credential.response.attestation_object.as_slice())
            .context("decode attestation object")?;
        let authenticator_data = match authenticator_data {
            serde_cbor_2::Value::Bytes(value) => value,
            _ => anyhow::bail!("invalid authenticator data"),
        };
        let (aaguid, public_key) = attested_credential_parts(&authenticator_data)?;
        anyhow::ensure!(
            credential.cred_id.as_slice() == public_key.credential_id.as_slice(),
            "credential id mismatch"
        );
        Ok(Self {
            id: credential.cred_id.as_slice().to_vec(),
            public_key: public_key.value,
            attestation_type: "none".to_owned(),
            attestation_format: fmt,
            transport: response
                .credential
                .response
                .transports
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(ToString::to_string)
                .collect(),
            flags: StoredCredentialFlags {
                user_present: true,
                user_verified: credential.user_verified,
                backup_eligible: credential.backup_eligible,
                backup_state: credential.backup_state,
            },
            authenticator: StoredAuthenticator {
                aaguid,
                sign_count: credential.counter,
                clone_warning: false,
                attachment: response.authenticator_attachment,
            },
            attestation: StoredAttestation {
                client_data_hash: Sha256::digest(response.credential.response.client_data_json.as_slice()).to_vec(),
                client_data_json: response.credential.response.client_data_json.as_slice().to_vec(),
                object: response.credential.response.attestation_object.as_slice().to_vec(),
                ..Default::default()
            },
        })
    }

    fn update_after_authentication(
        &mut self,
        counter: u32,
        user_verified: bool,
        backup_eligible: bool,
        backup_state: bool,
    ) {
        if counter <= self.authenticator.sign_count && (counter != 0 || self.authenticator.sign_count != 0) {
            self.authenticator.clone_warning = true;
        } else {
            self.authenticator.sign_count = counter;
        }
        self.flags = StoredCredentialFlags {
            user_present: true,
            user_verified,
            backup_eligible,
            backup_state,
        };
    }
}

#[derive(Deserialize)]
struct RegistrationAttestation {
    fmt: String,
    #[serde(rename = "authData")]
    authenticator_data: serde_cbor_2::Value,
}

#[derive(Deserialize)]
pub(super) struct RegistrationResponse {
    #[serde(flatten)]
    credential: RegisterPublicKeyCredential,
    #[serde(default, rename = "authenticatorAttachment")]
    authenticator_attachment: Option<String>,
}

struct AttestedCredentialPublicKey {
    credential_id: Vec<u8>,
    value: Vec<u8>,
}

fn attested_credential_parts(authenticator_data: &[u8]) -> Result<(Vec<u8>, AttestedCredentialPublicKey)> {
    const ATTESTED_CREDENTIAL_DATA: u8 = 0x40;
    const HEADER_LEN: usize = 37;
    const AAGUID_LEN: usize = 16;
    const ID_LEN_LEN: usize = 2;
    anyhow::ensure!(
        authenticator_data
            .get(32)
            .is_some_and(|flags| flags & ATTESTED_CREDENTIAL_DATA != 0),
        "attested credential data is required"
    );
    let aaguid_end = HEADER_LEN + AAGUID_LEN;
    let id_len_end = aaguid_end + ID_LEN_LEN;
    anyhow::ensure!(authenticator_data.len() >= id_len_end, "invalid authenticator data");
    let id_len = usize::from(u16::from_be_bytes(
        authenticator_data[aaguid_end..id_len_end]
            .try_into()
            .expect("fixed credential id length"),
    ));
    let key_start = id_len_end + id_len;
    anyhow::ensure!(authenticator_data.len() > key_start, "invalid authenticator data");
    let mut decoder = serde_cbor_2::Deserializer::from_slice(&authenticator_data[key_start..]);
    let _: serde_cbor_2::Value = Deserialize::deserialize(&mut decoder).context("decode webauthn public key")?;
    let key_end = key_start + decoder.byte_offset();
    Ok((
        authenticator_data[HEADER_LEN..aaguid_end].to_vec(),
        AttestedCredentialPublicKey {
            credential_id: authenticator_data[id_len_end..key_start].to_vec(),
            value: authenticator_data[key_start..key_end].to_vec(),
        },
    ))
}

fn credential_id(value: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(value)
}

fn is_zero(value: &i64) -> bool {
    *value == 0
}

fn is_zero_u32(value: &u32) -> bool {
    *value == 0
}

mod standard_base64 {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use serde::{Deserialize, Deserializer, Serializer};

    pub(super) fn serialize<S: Serializer>(value: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&STANDARD.encode(value))
    }

    pub(super) fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
        STANDARD
            .decode(String::deserialize(deserializer)?)
            .map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use url::Url;
    use webauthn_authenticator_rs::{WebauthnAuthenticator, softpasskey::SoftPasskey};
    use webauthn_rs_core::proto::{AuthenticatorAttachment, AuthenticatorTransport, UserVerificationPolicy};

    use super::{
        Credential, RegistrationAttestation, RegistrationResponse, StoredCredential, WebAuthnRpConfig,
        attested_credential_parts, new_core,
    };

    const GO_CREDENTIAL: &str = concat!(
        r#"{"id":"b0YfPFRExvFqk32Itj9qgZ2xrwxEIobhk0JYMhjGaxw=","publicKey":"pQECAyYgASFYIJ5ZILEiGS0+"#,
        r#"2bqBcahUy9tK4uIFQIwYyj5+xywNch12IlggqCMP7MRpjE1miRdGenYCuA9ABchEWvlgneyXutpsItU="#,
        r#"","attestationType":"basic_surrogate","attestationFormat":"packed","transport":["internal"],"#,
        r#""flags":{"userPresent":true,"userVerified":true,"backupEligible":false,"backupState":false},"#,
        r#""authenticator":{"AAGUID":"cd7Z6yntQFTH/Rgra6sbWQ=="},"#,
        r#""attestation":{"clientDataJSON":"eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoi"#,
        r#"MExKTWg0UmJRRXFhSHoxQy1fUGQ4VFZzdmlPOHFMWFFROGJUZ1JSMlFUYyIsIm9yaWdpbiI6Imh0dHA6"#,
        r#"Ly9sb2NhbGhvc3Q6MzAwMCJ9","clientDataHash":"Fw5q7aiBPAHebGdcpIVn6HMmt1JHRZM2axwwXyOZmls=","#,
        r#""object":"o2NmbXRmcGFja2VkZ2F0dFN0bXSiY2FsZyZjc2lnWEgwRgIhANvmUPuKFNLWjcCn+VRvePvJHOMjxXOS"#,
        r#"+8S/lz7RUgXQAiEA1Fem2zTaV9thF2YP0GCM4j2qCicStge/kgVfluEGA79oYXV0aERhdGFYpEmWDeWID"#,
        r#"oxodDQXD2R2YFuP5K65ooYyx5lc87qDHZdjRQAAAABx3tnrKe1AVMf9GCtrqxtZACBvRh88VETG8WqTfY"#,
        r#"i2P2qBnbGvDEQihuGTQlgyGMZrHKUBAgMmIAEhWCCeWSCxIhktPtm6gXGoVMvbSuLiBUCMGMo+fscsDX"#,
        r#"IddiJYIKgjD+zEaYxNZokXRnp2ArgPQAXIRFr5YJ3sl7rabCLV"}}"#,
    );

    #[test]
    fn reads_go_web_authn_credential_json() {
        let stored = StoredCredential::try_from(GO_CREDENTIAL).unwrap();
        let core = Credential::try_from(&stored).unwrap();

        assert_eq!(stored.id, core.cred_id.as_slice());
        assert!(stored.flags.user_present);
        assert!(stored.flags.user_verified);
        assert_eq!(stored.transport, ["internal"]);
        assert_eq!(stored.authenticator.aaguid.len(), 16);
        assert_eq!(stored.authenticator.attachment, None);
        let encoded = serde_json::to_string(&stored).unwrap();
        assert_eq!(serde_json::from_str::<StoredCredential>(&encoded).unwrap(), stored);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&encoded).unwrap()["publicKey"],
            "pQECAyYgASFYIJ5ZILEiGS0+2bqBcahUy9tK4uIFQIwYyj5+xywNch12IlggqCMP7MRpjE1miRdGenYCuA9ABchEWvlgneyXutpsItU="
        );
    }

    #[test]
    fn updates_signature_counters_and_marks_regressions_as_cloned() {
        let mut regressed = StoredCredential::try_from(GO_CREDENTIAL).unwrap();
        regressed.authenticator.sign_count = 2;
        regressed.update_after_authentication(1, true, false, false);
        assert!(regressed.authenticator.clone_warning);
        assert_eq!(regressed.authenticator.sign_count, 2);

        let mut advanced = StoredCredential::try_from(GO_CREDENTIAL).unwrap();
        advanced.authenticator.sign_count = 2;
        advanced.update_after_authentication(3, true, false, false);
        assert!(!advanced.authenticator.clone_warning);
        assert_eq!(advanced.authenticator.sign_count, 3);
    }

    #[test]
    fn soft_passkey_registration_uses_the_go_storage_shape() {
        let core = new_core(&WebAuthnRpConfig {
            rp_id: "tallyo.test".to_owned(),
            rp_display_name: "Tallyo".to_owned(),
            rp_origins: vec!["https://tallyo.test".to_owned()],
        })
        .unwrap();
        let builder = core
            .new_challenge_register_builder(b"7", "person@example.com", "person@example.com")
            .unwrap()
            .attestation(webauthn_rs_core::proto::AttestationConveyancePreference::None)
            .user_verification_policy(UserVerificationPolicy::Required)
            .require_resident_key(true)
            .authenticator_attachment(Some(AuthenticatorAttachment::Platform));
        let (mut options, state) = core.generate_challenge_register(builder).unwrap();
        let selection = options.public_key.authenticator_selection.as_mut().unwrap();
        selection.authenticator_attachment = None;
        selection.require_resident_key = false;
        let mut authenticator = WebauthnAuthenticator::new(SoftPasskey::new(true));
        let mut registration = authenticator
            .do_registration(Url::parse("https://tallyo.test").unwrap(), options)
            .unwrap();
        registration.response.transports = Some(vec![AuthenticatorTransport::Internal]);
        let mut credential = core.register_credential(&registration, &state, None).unwrap();
        credential.counter = 1;
        let mut stored = StoredCredential::from_registration(
            &credential,
            RegistrationResponse {
                credential: registration,
                authenticator_attachment: Some("platform".to_owned()),
            },
        )
        .unwrap();
        let json = serde_json::to_value(&stored).unwrap();
        let fixture = serde_json::from_str::<serde_json::Value>(GO_CREDENTIAL).unwrap();
        assert_eq!(object_keys(&json), object_keys(&fixture));
        assert_eq!(object_keys(&json["flags"]), object_keys(&fixture["flags"]));
        assert_eq!(
            object_keys(&json["authenticator"]),
            ["AAGUID", "attachment", "signCount"]
        );
        assert_eq!(object_keys(&json["attestation"]), object_keys(&fixture["attestation"]));
        assert_eq!(json["id"], serde_json::json!(STANDARD.encode(&stored.id)));
        assert_eq!(
            json["publicKey"],
            serde_json::json!(STANDARD.encode(&stored.public_key))
        );
        assert_eq!(
            json["flags"],
            serde_json::json!({
                "userPresent": true,
                "userVerified": stored.flags.user_verified,
                "backupEligible": stored.flags.backup_eligible,
                "backupState": stored.flags.backup_state,
            }),
        );
        assert_eq!(
            json["authenticator"]["AAGUID"],
            serde_json::json!(STANDARD.encode(&stored.authenticator.aaguid))
        );
        assert_eq!(json["authenticator"]["signCount"], 1);
        assert!(json["authenticator"].get("cloneWarning").is_none());
        assert_eq!(json["authenticator"]["attachment"], "platform");
        assert_eq!(json["transport"], serde_json::json!(["internal"]));
        assert_eq!(json["attestationType"], "none");
        assert_eq!(
            json["attestation"],
            serde_json::json!({
                "clientDataJSON": STANDARD.encode(&stored.attestation.client_data_json),
                "clientDataHash": STANDARD.encode(&stored.attestation.client_data_hash),
                "object": STANDARD.encode(&stored.attestation.object),
            }),
        );

        let RegistrationAttestation {
            authenticator_data: serde_cbor_2::Value::Bytes(authenticator_data),
            ..
        } = serde_cbor_2::from_slice(&stored.attestation.object).unwrap()
        else {
            panic!("attestation object must contain authenticator data")
        };
        let (_, attested) = attested_credential_parts(&authenticator_data).unwrap();
        assert_eq!(stored.public_key, attested.value);

        stored.authenticator.sign_count = 0;
        let stored_json = serde_json::to_string(&stored).unwrap();
        let parsed = Credential::try_from(&StoredCredential::try_from(stored_json.as_str()).unwrap()).unwrap();
        let builder = core
            .new_challenge_authenticate_builder(vec![parsed], Some(UserVerificationPolicy::Required))
            .unwrap();
        let (options, state) = core.generate_challenge_authenticate(builder).unwrap();
        let assertion = authenticator
            .do_authentication(Url::parse("https://tallyo.test").unwrap(), options)
            .unwrap();
        assert_eq!(
            core.authenticate_credential(&assertion, &state)
                .unwrap()
                .cred_id()
                .as_slice(),
            stored.id
        );
    }

    fn object_keys(value: &serde_json::Value) -> Vec<&str> {
        let mut keys = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>();
        keys.sort_unstable();
        keys
    }
}
