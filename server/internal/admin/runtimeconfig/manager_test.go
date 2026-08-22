package runtimeconfig

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

type fakeStore struct {
	sections           Sections
	loadErr            error
	saveErr            error
	adminPasskeyExists bool
	adminPasskeyErr    error
	saveCalls          int
	onSave             func()
}

func (s *fakeStore) LoadSections(context.Context) (Sections, error) {
	if s.loadErr != nil {
		return Sections{}, s.loadErr
	}
	return s.sections, nil
}

func (s *fakeStore) SaveSections(_ context.Context, patch Patch) (Sections, error) {
	s.saveCalls++
	if s.onSave != nil {
		s.onSave()
	}
	if s.saveErr != nil {
		return Sections{}, s.saveErr
	}
	s.sections = applyPatch(s.sections, patch)
	return s.sections, nil
}

func (s *fakeStore) AdminPasskeyExists(context.Context) (bool, error) {
	return s.adminPasskeyExists, s.adminPasskeyErr
}

func loadedManager(t *testing.T, store *fakeStore, envMasterPasswordAuth, authlessConfigAllowed bool) *Manager {
	t.Helper()
	manager := New(store)
	if err := manager.LoadConfiguration(context.Background(), envMasterPasswordAuth, authlessConfigAllowed); err != nil {
		t.Fatalf("LoadConfiguration() error = %v", err)
	}
	return manager
}

func TestManagerLoadConfiguration(t *testing.T) {
	store := &fakeStore{sections: Sections{
		General: storedSection(true, GeneralConfig{DisableWealthTracking: true}),
		Locale:  storedSection(false, LocaleConfig{Timezone: "America/Los_Angeles"}),
		MCP:     storedSection(true, MCPConfig{DynamicRedirectHosts: []string{"mcp.example.com"}}),
		Security: storedSection(true, SecurityConfig{
			TrustedProxyCIDRs: []string{"10.0.0.0/8"},
		}),
	}}
	manager := loadedManager(t, store, false, false)

	if got := manager.Sections(); !reflect.DeepEqual(got, store.sections) {
		t.Fatalf("Sections() = %+v", got)
	}
	if got := manager.Timezone(); got != "America/Los_Angeles" {
		t.Fatalf("Timezone() = %q", got)
	}

	store.loadErr = errors.New("database unavailable")
	if err := manager.LoadConfiguration(context.Background(), false, false); err == nil || err.Error() != "database unavailable" {
		t.Fatalf("LoadConfiguration() error = %v", err)
	}
	if got := manager.Timezone(); got != "America/Los_Angeles" {
		t.Fatalf("cache changed after failed load: %q", got)
	}
}

func TestManagerUpdateOrdersPreparationPersistenceCommitAndCallback(t *testing.T) {
	events := []string{}
	store := &fakeStore{sections: Sections{Auth: storedSection(true, AuthConfig{MasterPassword: stringPtr("secret")})}}
	store.onSave = func() { events = append(events, "save") }
	manager := loadedManager(t, store, false, false)
	manager.onPrepare([]SectionID{SectionGeneral}, func(context.Context, Sections) (func(), error) {
		events = append(events, "prepare")
		return func() { events = append(events, "commit") }, nil
	})
	manager.OnChange([]SectionID{SectionGeneral, SectionGoogle}, func() {
		_ = manager.Sections()
		events = append(events, "callback")
	})

	if err := manager.UpdateSections(context.Background(), Patch{}); err != nil || store.saveCalls != 0 {
		t.Fatalf("empty UpdateSections() error = %v, save calls = %d", err, store.saveCalls)
	}
	err := manager.UpdateSections(context.Background(), Patch{
		General: &SectionPatch[GeneralConfig]{Fields: GeneralConfig{HideOwners: true}},
		Google:  &SectionPatch[GoogleConfig]{Enabled: true},
	})
	if err != nil {
		t.Fatalf("UpdateSections() error = %v", err)
	}
	if want := []string{"prepare", "save", "commit", "callback"}; !reflect.DeepEqual(events, want) {
		t.Fatalf("events = %v, want %v", events, want)
	}
	if got := manager.Sections(); !got.General.Fields.HideOwners || !got.Google.Enabled {
		t.Fatalf("Sections() = %+v", got)
	}
}

func TestManagerRejectsInvalidUpdatesBeforePersistence(t *testing.T) {
	store := &fakeStore{sections: Sections{Auth: storedSection(true, AuthConfig{MasterPassword: stringPtr("secret")})}}
	manager := loadedManager(t, store, false, false)
	patches := []Patch{
		{Locale: &SectionPatch[LocaleConfig]{Fields: LocaleConfig{Timezone: "Not/AZone"}}},
		{WebAuthn: &SectionPatch[WebAuthnConfig]{Enabled: true, Fields: WebAuthnConfig{RPID: stringPtr("example.com:8080")}}},
		{LLM: &SectionPatch[LLMConfig]{Enabled: true}},
		{MCP: &SectionPatch[MCPConfig]{Fields: MCPConfig{DynamicRedirectHosts: []string{"example.com:443"}}}},
		{Security: &SectionPatch[SecurityConfig]{Fields: SecurityConfig{TrustedProxyCIDRs: []string{"not-a-cidr"}}}},
	}
	for _, patch := range patches {
		if err := manager.UpdateSections(context.Background(), patch); err == nil {
			t.Fatalf("UpdateSections(%#v) error = nil", patch)
		}
	}
	if store.saveCalls != 0 {
		t.Fatalf("SaveSections() calls = %d", store.saveCalls)
	}
}

func TestManagerPreservesValidationErrorOrder(t *testing.T) {
	manager := loadedManager(t, &fakeStore{}, false, true)
	err := manager.UpdateSections(context.Background(), Patch{
		WebAuthn: &SectionPatch[WebAuthnConfig]{
			Enabled: true,
			Fields:  WebAuthnConfig{RPID: new("example.com:8080")},
		},
		MCP: &SectionPatch[MCPConfig]{
			Fields: MCPConfig{DynamicRedirectHosts: []string{"example.com:443"}},
		},
	})
	assertValidationError(
		t,
		"invalid webauthn_rp_id \"example.com:8080\": use a valid bare hostname without scheme or port",
		err,
	)
}

func TestManagerPreparerFailureDoesNotPersist(t *testing.T) {
	store := &fakeStore{sections: Sections{Auth: storedSection(true, AuthConfig{MasterPassword: stringPtr("secret")})}}
	manager := loadedManager(t, store, false, false)
	manager.onPrepare([]SectionID{SectionGeneral}, func(context.Context, Sections) (func(), error) {
		return nil, errors.New("prepare failed")
	})

	err := manager.UpdateSections(context.Background(), Patch{General: &SectionPatch[GeneralConfig]{}})
	if err == nil || err.Error() != "prepare failed" {
		t.Fatalf("UpdateSections() error = %v", err)
	}
	if store.saveCalls != 0 || manager.Sections().General.Stored {
		t.Fatalf("configuration persisted after preparation failure: %+v", manager.Sections().General)
	}
}

func TestManagerSaveFailureDoesNotSwapCacheOrFireCallbacks(t *testing.T) {
	store := &fakeStore{
		sections: Sections{Auth: storedSection(true, AuthConfig{MasterPassword: stringPtr("secret")})},
		saveErr:  errors.New("database unavailable"),
	}
	manager := loadedManager(t, store, false, false)
	called := false
	manager.OnChange([]SectionID{SectionGeneral}, func() { called = true })

	err := manager.UpdateSections(context.Background(), Patch{General: &SectionPatch[GeneralConfig]{Enabled: true}})
	if err == nil || err.Error() != "upsert configuration sections: database unavailable" {
		t.Fatalf("UpdateSections() error = %v", err)
	}
	if called || manager.Sections().General.Stored {
		t.Fatalf("configuration changed after persistence failure: %+v", manager.Sections().General)
	}
}

func storedSection[T any](enabled bool, fields T) Section[T] {
	return Section[T]{Stored: true, Enabled: enabled, Fields: fields}
}
