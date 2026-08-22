package runtimeconfig

import (
	"context"
	"sync"

	u "tallyo/internal/utils"
)

type Store interface {
	LoadSections(ctx context.Context) (Sections, error)
	SaveSections(ctx context.Context, patch Patch) (Sections, error)
	AdminPasskeyExists(ctx context.Context) (bool, error)
}

type RuntimeAuthService interface {
	UpdateEmailConfig(enabled bool, host, port, from, username, password string)
	UpdateGoogleConfig(enabled bool, clientID, secret string)
	PrepareWebAuthnConfig(enabled bool, issuer, rpID, rpName string, rpOrigins []string) (func(), error)
	SetTimezone(timezone string)
}

type RuntimeClientIPResolver interface {
	SetTrustedProxyCIDRs(trustedProxyCIDRs []string) error
}

type callbackEntry struct {
	ids map[SectionID]struct{}
	fn  func()
}

type preparerEntry struct {
	ids map[SectionID]struct{}
	fn  func(context.Context, Sections) (func(), error)
}

type Manager struct {
	store                 Store
	mu                    sync.RWMutex
	sections              Sections
	callbacks             []callbackEntry
	preparers             []preparerEntry
	envMasterPasswordAuth bool
	authlessConfigAllowed bool
}

func New(store Store) *Manager {
	return &Manager{store: store}
}

func (m *Manager) LoadConfiguration(
	ctx context.Context,
	envMasterPasswordAuth bool,
	authlessConfigAllowed bool,
) error {
	sections, err := m.store.LoadSections(ctx)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.sections = sections
	m.envMasterPasswordAuth = envMasterPasswordAuth
	m.authlessConfigAllowed = authlessConfigAllowed
	m.mu.Unlock()
	return nil
}

func (m *Manager) Sections() Sections {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sections
}

func (m *Manager) ResolveRuntimeConfig(masterPassword string, disableAllAuth bool) (Sections, error) {
	sections := resolveRuntimeConfig(m.Sections(), masterPassword, disableAllAuth)
	if err := validateRuntimeConfig(sections); err != nil {
		return Sections{}, err
	}
	return sections, nil
}

func resolveRuntimeConfig(sections Sections, masterPassword string, disableAllAuth bool) Sections {
	if !sections.Auth.Stored {
		sections.Auth.Fields = AuthConfig{}
	}
	if masterPassword != "" {
		sections.Auth.Fields.MasterPassword = &masterPassword
	}
	if disableAllAuth {
		sections.Auth.Stored = true
		sections.Auth.Enabled = false
	}
	return sections
}

func (m *Manager) Timezone() string {
	locale := m.Sections().Locale
	if !locale.Stored {
		return u.FallbackTimezone
	}
	return u.NormalizeTimezone(locale.Fields.Timezone)
}
