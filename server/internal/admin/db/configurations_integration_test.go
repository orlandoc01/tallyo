package db

import (
	"context"
	"database/sql"
	"testing"

	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/database/dbtest"
)

func TestStoreSaveAndLoadSections(t *testing.T) {
	ctx := context.Background()
	database := dbtest.OpenAt(t, t.TempDir()+"/test.db")
	store := New(database)

	password := "password"
	clientID := "client"
	sections, err := store.SaveSections(ctx, runtimeconfig.Patch{
		Auth: &runtimeconfig.SectionPatch[runtimeconfig.AuthConfig]{
			Enabled: true,
			Fields: runtimeconfig.AuthConfig{
				AccessTokenLifetimeRaw:  "15m",
				DevCORSAllowedOrigins:   []string{"https://app.example"},
				FrontendRedirectURIs:    []string{"https://app.example/callback"},
				MasterPassword:          &password,
				OAuthIssuerURL:          "https://app.example",
				RefreshTokenLifetimeRaw: "24h",
			},
		},
		Google: &runtimeconfig.SectionPatch[runtimeconfig.GoogleConfig]{
			Enabled: true,
			Fields:  runtimeconfig.GoogleConfig{ClientID: &clientID},
		},
		General: &runtimeconfig.SectionPatch[runtimeconfig.GeneralConfig]{
			Enabled: true,
			Fields:  runtimeconfig.GeneralConfig{DisableTransactionTracking: true},
		},
	})
	if err != nil {
		t.Fatalf("SaveSections() error = %v", err)
	}
	hasAuth := sections.Auth.Stored && sections.Auth.Enabled &&
		sections.Auth.Fields.MasterPassword != nil && *sections.Auth.Fields.MasterPassword == password
	if !hasAuth {
		t.Fatalf("Auth = %#v", sections.Auth)
	}
	hasGoogle := sections.Google.Stored && sections.Google.Enabled &&
		sections.Google.Fields.ClientID != nil && *sections.Google.Fields.ClientID == clientID
	if !hasGoogle {
		t.Fatalf("Google = %#v", sections.Google)
	}
	if !sections.General.Stored || !sections.General.Enabled || !sections.General.Fields.DisableTransactionTracking {
		t.Fatalf("General = %#v", sections.General)
	}
	loaded, err := store.LoadSections(ctx)
	if err != nil {
		t.Fatalf("LoadSections() error = %v", err)
	}
	if !loaded.Auth.Stored || !loaded.Google.Stored || !loaded.General.Stored {
		t.Fatalf("LoadSections() = %#v", loaded)
	}
}

func TestStoreLoadSectionsRejectsBadStoredRows(t *testing.T) {
	ctx := context.Background()
	tests := []struct {
		name    string
		section string
		enabled bool
		fields  string
		wantErr string
	}{
		{
			name:    "malformed JSON",
			section: "GOOGLE",
			fields:  "{",
			wantErr: "load configuration section GOOGLE: unexpected end of JSON input",
		},
		{
			name:    "wrong field type",
			section: "AUTHORIZATION",
			enabled: true,
			fields:  `{"frontend_redirect_uris":"not-a-list"}`,
			wantErr: "load configuration section AUTHORIZATION: json: cannot unmarshal string into Go struct field " +
				"AuthConfig.frontend_redirect_uris of type []string",
		},
		{
			name:    "unknown section",
			section: "UNKNOWN",
			fields:  "{}",
			wantErr: `invalid configuration section "UNKNOWN"`,
		},
		{
			name:    "semantic validation",
			section: "LOCALE",
			fields:  `{"timezone":""}`,
			wantErr: "load configuration section LOCALE: timezone is required",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			database := dbtest.OpenAt(t, t.TempDir()+"/test.db")
			seedConfiguration(t, ctx, database.SQL(), tc.section, tc.enabled, tc.fields)

			_, err := New(database).LoadSections(ctx)
			if err == nil || err.Error() != tc.wantErr {
				t.Fatalf("LoadSections() error = %v, want %q", err, tc.wantErr)
			}
		})
	}
}

func TestStoreLoadSectionsAcceptsDefaultEmptyObjects(t *testing.T) {
	ctx := context.Background()
	database := dbtest.OpenAt(t, t.TempDir()+"/test.db")
	for _, section := range []string{
		"AUTHORIZATION",
		"EMAIL",
		"GENERAL",
		"GOOGLE",
		"LLM",
		"LOCALE",
		"MCP",
		"SECURITY",
		"SETUP_COMPLETE",
		"WEBAUTHN",
	} {
		seedConfiguration(t, ctx, database.SQL(), section, false, "{}")
	}

	sections, err := New(database).LoadSections(ctx)
	if err != nil {
		t.Fatalf("LoadSections() error = %v", err)
	}
	allStored := sections.Auth.Stored && sections.Email.Stored && sections.General.Stored && sections.Google.Stored &&
		sections.LLM.Stored && sections.Locale.Stored && sections.MCP.Stored && sections.Security.Stored &&
		sections.SetupComplete.Stored && sections.WebAuthn.Stored
	if !allStored {
		t.Fatalf("sections = %#v", sections)
	}
}

func TestStoreLoadSectionsIgnoresUnknownJSONKeys(t *testing.T) {
	ctx := context.Background()
	database := dbtest.OpenAt(t, t.TempDir()+"/test.db")
	seedConfiguration(t, ctx, database.SQL(), "GENERAL", false, `{"unknown":true}`)

	sections, err := New(database).LoadSections(ctx)
	if err != nil {
		t.Fatalf("LoadSections() error = %v", err)
	}
	if !sections.General.Stored || sections.General.Fields != (runtimeconfig.GeneralConfig{}) {
		t.Fatalf("General = %#v", sections.General)
	}
}

func TestStoreLoadSectionsDecodesEmptyFieldsAsZeroStruct(t *testing.T) {
	ctx := context.Background()
	database := dbtest.OpenAt(t, t.TempDir()+"/test.db")
	seedConfiguration(t, ctx, database.SQL(), "GENERAL", false, "")

	sections, err := New(database).LoadSections(ctx)
	if err != nil {
		t.Fatalf("LoadSections() error = %v", err)
	}
	if !sections.General.Stored || sections.General.Fields != (runtimeconfig.GeneralConfig{}) {
		t.Fatalf("General = %#v", sections.General)
	}
}

func TestStoreLoadSectionsDiscardsMCPNormalization(t *testing.T) {
	ctx := context.Background()
	database := dbtest.OpenAt(t, t.TempDir()+"/test.db")
	seedConfiguration(t, ctx, database.SQL(), "MCP", true, `{"dynamic_redirect_hosts":[" CLAUDE.AI "]}`)

	sections, err := New(database).LoadSections(ctx)
	if err != nil {
		t.Fatalf("LoadSections() error = %v", err)
	}
	if got := sections.MCP.Fields.DynamicRedirectHosts; len(got) != 1 || got[0] != " CLAUDE.AI " {
		t.Fatalf("MCP.DynamicRedirectHosts = %#v", got)
	}
}

func TestStoreSaveSectionsSkipsSemanticValidation(t *testing.T) {
	ctx := context.Background()
	database := dbtest.OpenAt(t, t.TempDir()+"/test.db")
	store := New(database)

	sections, err := store.SaveSections(ctx, runtimeconfig.Patch{
		Locale: &runtimeconfig.SectionPatch[runtimeconfig.LocaleConfig]{
			Fields: runtimeconfig.LocaleConfig{Timezone: "Not/AZone"},
		},
	})
	if err != nil {
		t.Fatalf("SaveSections() error = %v", err)
	}
	if !sections.Locale.Stored || sections.Locale.Fields.Timezone != "Not/AZone" {
		t.Fatalf("Locale = %#v", sections.Locale)
	}
}

func TestStoreSaveSectionsRollsBackWhenReloadFails(t *testing.T) {
	ctx := context.Background()
	database := dbtest.OpenAt(t, t.TempDir()+"/test.db")
	store := New(database)
	seedConfiguration(t, ctx, database.SQL(), "UNKNOWN", false, "{}")

	_, err := store.SaveSections(ctx, runtimeconfig.Patch{
		General: &runtimeconfig.SectionPatch[runtimeconfig.GeneralConfig]{
			Enabled: true,
			Fields:  runtimeconfig.GeneralConfig{HideOwners: true},
		},
	})
	if err == nil || err.Error() != `invalid configuration section "UNKNOWN"` {
		t.Fatalf("SaveSections() error = %v", err)
	}

	if _, err := database.SQL().ExecContext(ctx, `DELETE FROM configurations WHERE section = 'UNKNOWN'`); err != nil {
		t.Fatalf("delete invalid row: %v", err)
	}
	sections, err := store.LoadSections(ctx)
	if err != nil {
		t.Fatalf("LoadSections() error = %v", err)
	}
	if sections.General.Stored {
		t.Fatalf("General persisted after rollback: %#v", sections.General)
	}
}

func seedConfiguration(t *testing.T, ctx context.Context, database *sql.DB, section string, enabled bool, fields string) {
	t.Helper()
	_, err := database.ExecContext(ctx, `
		INSERT INTO configurations (section, enabled, fields, updated_at)
		VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
	`, section, enabled, fields)
	if err != nil {
		t.Fatalf("seed configuration: %v", err)
	}
}
