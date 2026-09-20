use axum::{body::to_bytes, http::StatusCode};
use chrono::{Duration, Utc};
use serde_json::Value;
use tower::ServiceExt;
use url::Url;
use webauthn_authenticator_rs::{WebauthnAuthenticator, softpasskey::SoftPasskey};
use webauthn_rs_core::proto::{
    AllowCredentials, AuthenticatorAttachment, CreationChallengeResponse, RequestChallengeResponse,
    UserVerificationPolicy,
};

use super::*;
use crate::{
    auth::{WebAuthnCredential, WebAuthnRegistration},
    schema::Role,
};

#[tokio::test]
async fn login_allows_signature_counter_regression_and_rejects_mismatched_user_handle() {
    let (service, pool) = setup_service(true, true, false).await;
    let token = bearer(&service, "admin@example.com");
    let registration_begin = router(Arc::clone(&service))
        .oneshot(json_request(
            "POST",
            "/auth/webauthn/register/begin",
            serde_json::json!({"name":"Laptop"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(registration_begin.status(), StatusCode::OK);
    let mut options: CreationChallengeResponse = serde_json::from_value(json(registration_begin).await).unwrap();
    let selection = options.public_key.authenticator_selection.as_ref().unwrap();
    assert_eq!(
        selection.authenticator_attachment,
        Some(AuthenticatorAttachment::Platform)
    );
    assert!(selection.require_resident_key);
    assert_eq!(selection.user_verification, UserVerificationPolicy::Required);
    assert_eq!(
        serde_json::to_value(options.public_key.attestation.as_ref().unwrap()).unwrap(),
        "none"
    );
    softpasskey_registration_options(&mut options);
    let mut authenticator = WebauthnAuthenticator::new(SoftPasskey::new(true));
    let registration = authenticator
        .do_registration(Url::parse(ISSUER).unwrap(), options)
        .unwrap();
    let credential_id = registration.raw_id.as_slice().to_vec();
    let mut registration = serde_json::to_value(registration).unwrap();
    registration["authenticatorAttachment"] = "platform".into();
    registration["response"]["transports"] = serde_json::json!(["internal"]);
    let registration_finish = router(Arc::clone(&service))
        .oneshot(json_request(
            "POST",
            "/auth/webauthn/register/finish",
            registration,
            Some(&token),
        ))
        .await
        .unwrap();
    let registration_status = registration_finish.status();
    let registration_body = to_bytes(registration_finish.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        registration_status,
        StatusCode::CREATED,
        "{}",
        String::from_utf8(registration_body.clone().to_vec()).unwrap()
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&registration_body).unwrap()["name"],
        "Laptop"
    );
    let user_id = service
        .store()
        .user_id_by_email("admin@example.com")
        .await
        .unwrap()
        .unwrap();
    let credential = service
        .store()
        .webauthn_credentials_by_user_id(user_id)
        .await
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
    let mut stored: Value = serde_json::from_str(&credential.credential).unwrap();
    stored["authenticator"]["signCount"] = 100.into();
    service
        .store()
        .update_webauthn_credential(&credential.id, &serde_json::to_string(&stored).unwrap(), Utc::now())
        .await
        .unwrap();

    let session = login_session("passkey-login", "tallyo-web", REDIRECT_URI, "read write");
    service.store().create_login_session(&session).await.unwrap();
    let login_begin = router(Arc::clone(&service))
        .oneshot(json_request(
            "POST",
            "/auth/webauthn/login/begin",
            serde_json::json!({"login_session_id":"passkey-login"}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(login_begin.status(), StatusCode::OK);
    let mut options: RequestChallengeResponse = serde_json::from_value(json(login_begin).await).unwrap();
    assert!(options.public_key.allow_credentials.is_empty());
    assert_eq!(options.public_key.user_verification, UserVerificationPolicy::Required);
    options.public_key.allow_credentials = vec![AllowCredentials {
        type_: "public-key".to_owned(),
        id: credential_id.clone().into(),
        transports: None,
    }];
    let mut assertion = authenticator
        .do_authentication(Url::parse(ISSUER).unwrap(), options)
        .unwrap();
    assertion.response.user_handle = Some(user_id.to_string().into_bytes().into());
    let login_finish = router(Arc::clone(&service))
        .oneshot(json_request(
            "POST",
            "/auth/webauthn/login/finish",
            serde_json::json!({"login_session_id":"passkey-login","assertion":assertion}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(login_finish.status(), StatusCode::OK);
    assert_eq!(
        json(login_finish).await["redirect_url"],
        format!("{ISSUER}/authorize?session_id=passkey-login")
    );
    let updated_credential = service
        .store()
        .webauthn_credentials_by_user_id(user_id)
        .await
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
    let updated: Value = serde_json::from_str(&updated_credential.credential).unwrap();
    assert_eq!(updated["authenticator"]["signCount"], 100);
    assert!(updated_credential.last_used_at.is_some());
    assert!(
        service
            .store()
            .login_session_by_id("passkey-login")
            .await
            .unwrap()
            .is_some_and(|session| session.authenticated && session.subject == "admin@example.com")
    );

    let other_user_id = add_user(&pool, "other@example.com", Role::Admin).await;
    let session = login_session("mismatched-user-handle", "tallyo-web", REDIRECT_URI, "read write");
    service.store().create_login_session(&session).await.unwrap();
    let login_begin = router(Arc::clone(&service))
        .oneshot(json_request(
            "POST",
            "/auth/webauthn/login/begin",
            serde_json::json!({"login_session_id":"mismatched-user-handle"}),
            None,
        ))
        .await
        .unwrap();
    let mut options: RequestChallengeResponse = serde_json::from_value(json(login_begin).await).unwrap();
    options.public_key.allow_credentials = vec![AllowCredentials {
        type_: "public-key".to_owned(),
        id: credential_id.into(),
        transports: None,
    }];
    let mut assertion = authenticator
        .do_authentication(Url::parse(ISSUER).unwrap(), options)
        .unwrap();
    assertion.response.user_handle = Some(other_user_id.to_string().into_bytes().into());
    let rejected = router(Arc::clone(&service))
        .oneshot(json_request(
            "POST",
            "/auth/webauthn/login/finish",
            serde_json::json!({"login_session_id":"mismatched-user-handle","assertion":assertion}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    assert!(
        service
            .store()
            .login_session_by_id("mismatched-user-handle")
            .await
            .unwrap()
            .is_some_and(|session| !session.authenticated)
    );
}

#[tokio::test]
async fn rejects_expired_registration_and_disabled_passkeys() {
    let (service, _) = setup_service(true, true, false).await;
    let token = bearer(&service, "admin@example.com");
    let registration_begin = router(Arc::clone(&service))
        .oneshot(json_request(
            "POST",
            "/auth/webauthn/register/begin",
            serde_json::json!({"name":"Laptop"}),
            Some(&token),
        ))
        .await
        .unwrap();
    let mut options: CreationChallengeResponse = serde_json::from_value(json(registration_begin).await).unwrap();
    let user_id = service
        .store()
        .user_id_by_email("admin@example.com")
        .await
        .unwrap()
        .unwrap();
    let registration = service.store().webauthn_registration(user_id).await.unwrap().unwrap();
    service
        .store()
        .save_webauthn_registration(&WebAuthnRegistration {
            expires_at: (Utc::now() - Duration::seconds(1)).into(),
            ..registration
        })
        .await
        .unwrap();
    softpasskey_registration_options(&mut options);
    let mut authenticator = WebauthnAuthenticator::new(SoftPasskey::new(true));
    let response = authenticator
        .do_registration(Url::parse(ISSUER).unwrap(), options)
        .unwrap();
    let expired = router(Arc::clone(&service))
        .oneshot(json_request(
            "POST",
            "/auth/webauthn/register/finish",
            serde_json::to_value(response).unwrap(),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(expired.status(), StatusCode::BAD_REQUEST);

    let (disabled, _) = setup_service(false, true, false).await;
    let disabled_response = router(disabled)
        .oneshot(json_request(
            "POST",
            "/auth/webauthn/login/begin",
            serde_json::json!({"login_session_id":"missing"}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(disabled_response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn registration_finish_email_fallback_requires_incomplete_setup() {
    let (setup, _) = setup_service(true, false, true).await;
    let fallback_begin = router(Arc::clone(&setup))
        .oneshot(json_request(
            "POST",
            "/auth/webauthn/register/begin",
            serde_json::json!({"name":"Laptop","email":"admin@example.com"}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(fallback_begin.status(), StatusCode::OK);
    let mut options: CreationChallengeResponse = serde_json::from_value(json(fallback_begin).await).unwrap();
    softpasskey_registration_options(&mut options);
    let mut authenticator = WebauthnAuthenticator::new(SoftPasskey::new(true));
    let registration = authenticator
        .do_registration(Url::parse(ISSUER).unwrap(), options)
        .unwrap();
    let fallback_finish = router(setup)
        .oneshot(json_request(
            "POST",
            "/auth/webauthn/register/finish?email=admin@example.com",
            serde_json::to_value(registration).unwrap(),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(fallback_finish.status(), StatusCode::CREATED);

    let (complete, _) = setup_service(true, true, true).await;
    let rejected = router(complete)
        .oneshot(json_request(
            "POST",
            "/auth/webauthn/register/finish?email=admin@example.com",
            serde_json::json!({}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn incomplete_setup_rejects_an_unknown_registration_email() {
    let (service, _) = setup_service(true, false, true).await;
    let response = router(service)
        .oneshot(json_request(
            "POST",
            "/auth/webauthn/register/begin",
            serde_json::json!({"name":"Laptop","email":"unknown@example.com"}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(body.as_ref(), b"lookup authenticated user");
}

#[tokio::test]
async fn webauthn_login_shares_the_email_rate_limit() {
    let (service, _) = setup_service(true, true, false).await;
    let app = router(service);
    for _ in 0..5 {
        app.clone()
            .oneshot(json_request("POST", "/auth/email/send", serde_json::json!({}), None))
            .await
            .unwrap();
    }
    let response = app
        .oneshot(json_request(
            "POST",
            "/auth/webauthn/login/begin",
            serde_json::json!({"login_session_id":"missing"}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
}

fn softpasskey_registration_options(options: &mut CreationChallengeResponse) {
    let selection = options.public_key.authenticator_selection.as_mut().unwrap();
    selection.authenticator_attachment = None;
    selection.require_resident_key = false;
}

#[tokio::test]
async fn credential_renames_and_deletes_are_scoped_to_the_owner() {
    let (service, pool) = setup_service(true, true, false).await;
    let other_id = add_user(&pool, "other@example.com", Role::Admin).await;
    service
        .store()
        .create_webauthn_credential(&WebAuthnCredential {
            id: "credential".to_owned(),
            user_id: other_id,
            name: "Other passkey".to_owned(),
            credential: "{}".to_owned(),
            created_at: Utc::now().into(),
            last_used_at: None,
        })
        .await
        .unwrap();
    let token = bearer(&service, "admin@example.com");
    for (method, body) in [
        ("PATCH", serde_json::json!({"name":"Renamed"})),
        ("DELETE", serde_json::json!({})),
    ] {
        let response = router(Arc::clone(&service))
            .oneshot(json_request(
                method,
                "/auth/webauthn/credentials/credential",
                body,
                Some(&token),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    let owner_id = service
        .store()
        .user_id_by_email("admin@example.com")
        .await
        .unwrap()
        .unwrap();
    service
        .store()
        .create_webauthn_credential(&WebAuthnCredential {
            id: "own-credential".to_owned(),
            user_id: owner_id,
            name: "Laptop".to_owned(),
            credential: "{}".to_owned(),
            created_at: Utc::now().into(),
            last_used_at: None,
        })
        .await
        .unwrap();
    let list = router(Arc::clone(&service))
        .oneshot(json_request(
            "GET",
            "/auth/webauthn/credentials",
            serde_json::json!({}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(list.status(), StatusCode::OK);
    assert_eq!(json(list).await[0]["id"], "own-credential");
    let rename = router(Arc::clone(&service))
        .oneshot(json_request(
            "PATCH",
            "/auth/webauthn/credentials/own-credential",
            serde_json::json!({"name":"Desktop"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(rename.status(), StatusCode::NO_CONTENT);
    let delete = router(service)
        .oneshot(json_request(
            "DELETE",
            "/auth/webauthn/credentials/own-credential",
            serde_json::json!({}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(delete.status(), StatusCode::NO_CONTENT);
}
