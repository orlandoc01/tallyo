package accounts

import (
	"context"
	"log/slog"

	"tallyo/internal/clients"
	u "tallyo/internal/utils"
)

type LogoBackfillStore interface {
	PlaidItemsMissingLogoURL(ctx context.Context) ([]PlaidItemSecret, error)
	SetPlaidItemLogoURL(ctx context.Context, itemID int64, logoURL *string) error
}

type LogoBackfiller struct {
	Store   LogoBackfillStore
	Clients clients.PlaidClientFactory
	Log     *slog.Logger
}

func (b *LogoBackfiller) Backfill(ctx context.Context) error {
	items, err := b.Store.PlaidItemsMissingLogoURL(ctx)
	if err != nil {
		return err
	}
	for _, item := range items {
		if item.InstitutionID == nil || *item.InstitutionID == "" {
			continue
		}
		client, err := b.Clients.ClientForCredential(ctx, item.CredentialID)
		if err != nil {
			b.Log.Error("plaid item logo backfill client", "item_id", item.ID, "error", err)
			continue
		}
		_, logoURL := resolveInstitutionMetadata(ctx, client, item.InstitutionID, nil)
		if logoURL == nil {
			continue
		}
		if err := b.Store.SetPlaidItemLogoURL(ctx, item.ID, logoURL); err != nil {
			b.Log.Error("plaid item logo backfill update", "item_id", item.ID, "error", err)
			continue
		}
	}
	return nil
}

func resolveInstitutionMetadata(
	ctx context.Context,
	client clients.PlaidClient,
	institutionID *string,
	providedName *string,
) (*string, *string) {
	if institutionID == nil || *institutionID == "" {
		return providedName, nil
	}
	institution, err := client.Institution(ctx, *institutionID)
	if err != nil {
		return providedName, nil
	}
	name := providedName
	if name == nil {
		if institutionName := institution.GetName(); institutionName != "" {
			name = &institutionName
		}
	}
	return name, u.DuckDuckGoFaviconURL(institution.GetUrl())
}
