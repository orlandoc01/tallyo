package runtimeconfig

import (
	"context"
	"fmt"
	"slices"

	"github.com/samber/lo"

	"tallyo/internal/apierror"
	u "tallyo/internal/utils"
)

func (m *Manager) UpdateSections(ctx context.Context, patch Patch) error {
	if len(patch.sections()) == 0 {
		return nil
	}
	if err := validatePatch(&patch); err != nil {
		return err
	}

	changed := patch.sections()
	m.mu.Lock()
	prospective := applyPatch(m.sections, patch)
	if err := m.validateAuthProspective(ctx, prospective); err != nil {
		m.mu.Unlock()
		return err
	}

	preparers := lo.Filter(m.preparers, func(entry preparerEntry, _ int) bool {
		return sectionsOverlap(entry.ids, changed)
	})
	prepare := func(entry preparerEntry) (func(), error) {
		return entry.fn(ctx, prospective)
	}
	commits, err := u.MapErr(preparers, prepare)
	if err != nil {
		m.mu.Unlock()
		return err
	}

	saved, err := m.store.SaveSections(ctx, patch)
	if err != nil {
		m.mu.Unlock()
		return fmt.Errorf("upsert configuration sections: %w", err)
	}
	m.sections = saved
	lo.ForEach(commits, func(commit func(), _ int) { commit() })
	callbacks := slices.Clone(m.callbacks)
	m.mu.Unlock()

	lo.ForEach(callbacks, func(entry callbackEntry, _ int) {
		if sectionsOverlap(entry.ids, changed) {
			entry.fn()
		}
	})
	return nil
}

func (m *Manager) OnChange(ids []SectionID, fn func()) {
	m.mu.Lock()
	m.callbacks = append(m.callbacks, callbackEntry{ids: lo.SliceToMap(ids, sectionSet), fn: fn})
	m.mu.Unlock()
}

func (m *Manager) onPrepare(ids []SectionID, fn func(context.Context, Sections) (func(), error)) {
	m.mu.Lock()
	m.preparers = append(m.preparers, preparerEntry{ids: lo.SliceToMap(ids, sectionSet), fn: fn})
	m.mu.Unlock()
}

func sectionSet(id SectionID) (SectionID, struct{}) {
	return id, struct{}{}
}

func sectionsOverlap(ids map[SectionID]struct{}, changed []SectionID) bool {
	return lo.ContainsBy(changed, func(id SectionID) bool {
		_, ok := ids[id]
		return ok
	})
}

func validatePatch(patch *Patch) error {
	if patch.Locale != nil {
		if err := patch.Locale.Fields.Validate(patch.Locale.Enabled); err != nil {
			return err
		}
	}
	if patch.LLM != nil {
		if err := patch.LLM.Fields.Validate(patch.LLM.Enabled); err != nil {
			return err
		}
	}
	if patch.WebAuthn != nil {
		if err := patch.WebAuthn.Fields.Validate(patch.WebAuthn.Enabled); err != nil {
			return err
		}
	}
	if patch.MCP != nil {
		normalized, err := patch.MCP.Fields.Normalize()
		if err != nil {
			return err
		}
		patch.MCP.Fields = normalized
	}
	if patch.Security != nil {
		if err := patch.Security.Fields.Validate(patch.Security.Enabled); err != nil {
			return err
		}
	}
	return nil
}

func applyPatch(sections Sections, patch Patch) Sections {
	sections.Auth = applySectionPatch(sections.Auth, patch.Auth)
	sections.Email = applySectionPatch(sections.Email, patch.Email)
	sections.General = applySectionPatch(sections.General, patch.General)
	sections.Google = applySectionPatch(sections.Google, patch.Google)
	sections.LLM = applySectionPatch(sections.LLM, patch.LLM)
	sections.Locale = applySectionPatch(sections.Locale, patch.Locale)
	sections.MCP = applySectionPatch(sections.MCP, patch.MCP)
	sections.Security = applySectionPatch(sections.Security, patch.Security)
	sections.SetupComplete = applySectionPatch(sections.SetupComplete, patch.SetupComplete)
	sections.WebAuthn = applySectionPatch(sections.WebAuthn, patch.WebAuthn)
	return sections
}

func applySectionPatch[T any](section Section[T], patch *SectionPatch[T]) Section[T] {
	if patch != nil {
		section.Stored = true
		section.Enabled = patch.Enabled
		section.Fields = patch.Fields
	}
	return section
}

func (m *Manager) validateAuthProspective(ctx context.Context, prospective Sections) error {
	envMasterPassword := lo.Ternary(m.envMasterPasswordAuth, "configured", "")
	prospective = resolveRuntimeConfig(prospective, envMasterPassword, m.authlessConfigAllowed)
	authConfig := prospective.Auth.Fields
	if prospective.Auth.Stored && !prospective.Auth.Enabled {
		return validateDisableAllAuthIssuer(authConfig.OAuthIssuerURL)
	}

	hasRealAuth := prospective.OAuthEnabled()
	hasMasterPassword := lo.FromPtr(authConfig.MasterPassword) != ""
	if prospective.SetupComplete.Enabled && !hasMasterPassword && !hasRealAuth {
		return apierror.Publicf(
			"setup completion requires at least one auth method: configure MASTER_PASSWORD or enable google_authn, email_code_authn, or passkey_authn",
		)
	}
	if !m.authlessConfigAllowed && !hasMasterPassword && !hasRealAuth {
		return apierror.Publicf(
			"at least one auth method required: enable google_authn, email_code_authn, passkey_authn, or configure MASTER_PASSWORD",
		)
	}
	if err := validateRuntimeConfig(prospective); err != nil {
		return err
	}

	noOtherOAuthAuth := !prospective.Google.Enabled && !prospective.Email.Enabled
	passkeyOnly := prospective.SetupComplete.Enabled && !hasMasterPassword && noOtherOAuthAuth && prospective.WebAuthn.Enabled
	if !passkeyOnly {
		return nil
	}
	exists, err := m.store.AdminPasskeyExists(ctx)
	if err != nil {
		return fmt.Errorf("check admin passkey: %w", err)
	}
	if !exists {
		return apierror.Publicf(
			"passkey-only sign-in requires at least one admin passkey before disabling other sign-in methods",
		)
	}
	return nil
}
