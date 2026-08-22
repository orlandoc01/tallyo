package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/database/dbgen"
)

var _ runtimeconfig.Store = (*Store)(nil)

func (s *Store) AdminPasskeyExists(ctx context.Context) (bool, error) {
	return s.q.AdminPasskeyExists(ctx)
}

func (s *Store) LoadSections(ctx context.Context) (runtimeconfig.Sections, error) {
	return loadSections(ctx, s.q, true)
}

func (s *Store) SaveSections(ctx context.Context, patch runtimeconfig.Patch) (runtimeconfig.Sections, error) {
	var sections runtimeconfig.Sections
	err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		if err := savePatchedSections(ctx, q, patch); err != nil {
			return err
		}
		var err error
		sections, err = loadSections(ctx, q, false)
		return err
	})
	return sections, err
}

func loadSections(ctx context.Context, q *dbgen.Queries, validate bool) (runtimeconfig.Sections, error) {
	rows, err := q.ListConfigurationSections(ctx)
	if err != nil {
		return runtimeconfig.Sections{}, fmt.Errorf("list configuration sections: %w", err)
	}

	var sections runtimeconfig.Sections
	for _, row := range rows {
		known, err := decodeConfigurationSection(row, &sections, validate)
		if !known {
			return runtimeconfig.Sections{}, fmt.Errorf("invalid configuration section %q", row.Section)
		}
		if err != nil {
			return runtimeconfig.Sections{}, fmt.Errorf("load configuration section %s: %w", row.Section, err)
		}
	}
	return sections, nil
}

func decodeConfigurationSection(
	row dbgen.ListConfigurationSectionsRow,
	sections *runtimeconfig.Sections,
	validate bool,
) (bool, error) {
	shouldValidate := validate && (row.Enabled || strings.TrimSpace(row.Fields) != "{}")
	switch runtimeconfig.SectionID(row.Section) {
	case runtimeconfig.SectionAuth:
		return true, decodeSection(row, &sections.Auth, false, nil)
	case runtimeconfig.SectionEmail:
		return true, decodeSection(row, &sections.Email, false, nil)
	case runtimeconfig.SectionGeneral:
		return true, decodeSection(row, &sections.General, false, nil)
	case runtimeconfig.SectionGoogle:
		return true, decodeSection(row, &sections.Google, false, nil)
	case runtimeconfig.SectionLLM:
		return true, decodeSection(row, &sections.LLM, shouldValidate, runtimeconfig.LLMConfig.Validate)
	case runtimeconfig.SectionLocale:
		return true, decodeSection(row, &sections.Locale, shouldValidate, runtimeconfig.LocaleConfig.Validate)
	case runtimeconfig.SectionMCP:
		return true, decodeSection(row, &sections.MCP, shouldValidate, validateMCPConfig)
	case runtimeconfig.SectionSecurity:
		return true, decodeSection(row, &sections.Security, shouldValidate, runtimeconfig.SecurityConfig.Validate)
	case runtimeconfig.SectionSetupComplete:
		return true, decodeSection(row, &sections.SetupComplete, false, nil)
	case runtimeconfig.SectionWebAuthn:
		return true, decodeSection(row, &sections.WebAuthn, shouldValidate, runtimeconfig.WebAuthnConfig.Validate)
	default:
		return false, nil
	}
}

func decodeSection[T any](
	row dbgen.ListConfigurationSectionsRow,
	destination *runtimeconfig.Section[T],
	validate bool,
	validator func(T, bool) error,
) error {
	var fields T
	if row.Fields != "" {
		if err := json.Unmarshal([]byte(row.Fields), &fields); err != nil {
			return err
		}
	}
	if validate {
		if err := validator(fields, row.Enabled); err != nil {
			return err
		}
	}
	*destination = runtimeconfig.Section[T]{
		Stored:  true,
		Enabled: row.Enabled,
		Fields:  fields,
	}
	return nil
}

func validateMCPConfig(config runtimeconfig.MCPConfig, _ bool) error {
	_, err := config.Normalize()
	return err
}

func savePatchedSections(ctx context.Context, q *dbgen.Queries, patch runtimeconfig.Patch) error {
	if err := saveSection(ctx, q, runtimeconfig.SectionAuth, patch.Auth); err != nil {
		return err
	}
	if err := saveSection(ctx, q, runtimeconfig.SectionEmail, patch.Email); err != nil {
		return err
	}
	if err := saveSection(ctx, q, runtimeconfig.SectionGeneral, patch.General); err != nil {
		return err
	}
	if err := saveSection(ctx, q, runtimeconfig.SectionGoogle, patch.Google); err != nil {
		return err
	}
	if err := saveSection(ctx, q, runtimeconfig.SectionLLM, patch.LLM); err != nil {
		return err
	}
	if err := saveSection(ctx, q, runtimeconfig.SectionLocale, patch.Locale); err != nil {
		return err
	}
	if err := saveSection(ctx, q, runtimeconfig.SectionMCP, patch.MCP); err != nil {
		return err
	}
	if err := saveSection(ctx, q, runtimeconfig.SectionSecurity, patch.Security); err != nil {
		return err
	}
	if err := saveSection(ctx, q, runtimeconfig.SectionSetupComplete, patch.SetupComplete); err != nil {
		return err
	}
	return saveSection(ctx, q, runtimeconfig.SectionWebAuthn, patch.WebAuthn)
}

func saveSection[T any](
	ctx context.Context,
	q *dbgen.Queries,
	id runtimeconfig.SectionID,
	patch *runtimeconfig.SectionPatch[T],
) error {
	if patch == nil {
		return nil
	}

	fields, err := json.Marshal(patch.Fields)
	if err != nil {
		return err
	}
	return q.UpsertConfigurationSection(ctx, dbgen.UpsertConfigurationSectionParams{
		Section: string(id),
		Enabled: patch.Enabled,
		Fields:  string(fields),
	})
}
