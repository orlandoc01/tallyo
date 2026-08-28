package authdb

import (
	"encoding/json"
	"fmt"

	"tallyo/internal/auth/authtypes"
	"tallyo/internal/database/dbgen"

	"github.com/samber/lo"
)

func oauthClientFromSQL(row dbgen.OAuthClientRow) (authtypes.OAuthClient, error) {
	client := authtypes.OAuthClient{
		ID:              row.ID,
		Scopes:          splitSpace(row.Scopes),
		ApplicationType: row.ApplicationType,
		ClientName:      row.ClientName,
		Public:          row.IsPublic,
		Preseeded:       row.IsPreseeded,
	}
	if err := json.Unmarshal([]byte(row.RedirectUris), &client.RedirectURIs); err != nil {
		return authtypes.OAuthClient{}, fmt.Errorf("parse oauth client redirect_uris: %w", err)
	}
	if err := json.Unmarshal([]byte(row.GrantTypes), &client.GrantTypes); err != nil {
		return authtypes.OAuthClient{}, fmt.Errorf("parse oauth client grant_types: %w", err)
	}
	if err := json.Unmarshal([]byte(row.ResponseTypes), &client.ResponseTypes); err != nil {
		return authtypes.OAuthClient{}, fmt.Errorf("parse oauth client response_types: %w", err)
	}
	return client, nil
}

func loginSessionFromSQL(row dbgen.LoginSessionsRow) authtypes.LoginSession {
	session := authtypes.LoginSession{
		ID:                  row.ID,
		ClientID:            row.ClientID,
		RedirectURI:         row.RedirectUri,
		State:               row.State,
		CodeChallenge:       row.CodeChallenge,
		CodeChallengeMethod: row.CodeChallengeMethod,
		Scopes:              splitSpace(row.Scopes),
		CallbackState:       row.CallbackState,
		Subject:             row.Subject,
		Authenticated:       row.Authenticated,
		Email:               row.Email,
		EmailOTP:            row.EmailOtp,
		EmailOTPAttempts:    int(row.EmailOtpAttempts),
		EmailMagicToken:     row.EmailMagicToken,
		PKCEVerifier:        row.PkceVerifier,
		WebAuthnSession:     row.WebauthnSession,
		Purpose:             row.Purpose,
		ExpiresAt:           row.ExpiresAt,
		EmailOTPExpiresAt:   lo.FromPtr(row.EmailOtpExpiresAt),
	}
	return session
}

func authCodeFromSQL(row dbgen.AuthCodeRow) authtypes.AuthCode {
	return authtypes.AuthCode{
		ClientID:            row.ClientID,
		Subject:             row.Subject,
		Scopes:              splitSpace(row.Scopes),
		RedirectURI:         row.RedirectUri,
		CodeChallenge:       row.CodeChallenge,
		CodeChallengeMethod: row.CodeChallengeMethod,
		ExpiresAt:           row.ExpiresAt,
		Active:              row.Active,
	}
}

type tokenSQLRow interface {
	dbgen.AccessTokenRow | dbgen.RefreshTokenRow
}

func tokenFromSQL[Row tokenSQLRow](signature string, sqlRow Row) authtypes.OAuthToken {
	row := dbgen.AccessTokenRow(sqlRow)
	return authtypes.OAuthToken{
		Signature: signature,
		ClientID:  row.ClientID,
		Subject:   row.Subject,
		Scopes:    splitSpace(row.Scopes),
		ExpiresAt: row.ExpiresAt,
		RequestID: row.RequestID,
		Active:    row.Active,
	}
}
