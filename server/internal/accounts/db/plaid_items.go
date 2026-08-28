package accountsdb

import (
	"context"

	"tallyo/internal/accounts"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
)

func (s *Store) UpsertPlaidItem(ctx context.Context, item accounts.PlaidItemSecret) (int64, error) {
	id, err := s.q.UpsertPlaidItem(ctx, dbgen.UpsertPlaidItemParams{
		ExternalID:              item.ExternalID,
		CredentialID:            int64(item.CredentialID),
		AccessToken:             item.AccessToken,
		InstitutionID:           item.InstitutionID,
		LogoUrl:                 item.LogoURL,
		NextSyncAt:              dbutil.UTCTimePtr(item.NextSyncAt),
		NextRecurringSyncAt:     dbutil.UTCTimePtr(item.NextRecurringSyncAt),
		NextBalanceSyncAt:       dbutil.UTCTimePtr(item.NextBalanceSyncAt),
		PlaidInvestmentsEnabled: item.InvestmentsEnabled,
		PlaidLiabilitiesEnabled: item.LiabilitiesEnabled,
	})
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (s *Store) PlaidItems(ctx context.Context, includeInactive bool) ([]*model.PlaidItem, error) {
	rows, err := s.q.ListPlaidItems(ctx, dbgen.ListPlaidItemsParams{ActiveOnly: !includeInactive})
	return dbutil.MapRows(rows, err, PlaidItemFromSQLRow)
}

func (s *Store) PlaidItem(ctx context.Context, id int64) (*model.PlaidItem, error) {
	items, err := s.PlaidItemsByIDs(ctx, []int64{id})
	return dbutil.MapSingle(items, err, id)
}

func (s *Store) PlaidItemsByIDs(ctx context.Context, ids []int64) (map[int64]*model.PlaidItem, error) {
	if len(ids) == 0 {
		return map[int64]*model.PlaidItem{}, nil
	}
	rows, err := s.q.ListPlaidItems(ctx, dbgen.ListPlaidItemsParams{Ids: ids})
	toPlaidItemByID := func(row dbgen.ListPlaidItemsRow) (int64, *model.PlaidItem) {
		return row.ItemID, PlaidItemFromSQLRow(row)
	}
	return dbutil.AssociateRows(rows, err, toPlaidItemByID)
}

func PlaidItemFromSQLRow(row dbgen.ListPlaidItemsRow) *model.PlaidItem {
	item := &model.PlaidItem{
		ID:                  model.New(model.GlobalIDPlaidItem, row.ItemID),
		Credential:          &model.PlaidCredential{ID: int32(row.CredentialID)},
		InstitutionID:       row.InstitutionID,
		LastSyncedAt:        row.LastSyncedAt,
		HealthState:         model.PlaidItemHealthState(row.HealthState),
		HealthErrorCode:     row.HealthErrorCode,
		HealthErrorMessage:  row.HealthErrorMessage,
		HealthUpdatedAt:     row.HealthUpdatedAt,
		SyncCron:            row.SyncCron,
		RecurringSyncCron:   row.RecurringSyncCron,
		NextSyncAt:          row.NextSyncAt,
		NextRecurringSyncAt: row.NextRecurringSyncAt,
		IsActive:            row.ConnectionIsActive,
		CreatedAt:           row.CreatedAt,
		UpdatedAt:           row.UpdatedAt,
	}
	if !item.HealthState.IsValid() {
		item.HealthState = model.PlaidItemHealthStateHealthy
	}
	return item
}

func (s *Store) PlaidItemSecret(ctx context.Context, id int64) (*accounts.PlaidItemSecret, error) {
	return PlaidItemSecretByID(ctx, s.q, id, accounts.PlaidSyncKindTransactions)
}

func PlaidItemSecretByID(ctx context.Context, q *dbgen.Queries, id int64, kind accounts.PlaidSyncKind) (*accounts.PlaidItemSecret, error) {
	rows, err := q.PlaidItemsDue(ctx, dbgen.PlaidItemsDueParams{ID: &id, Kind: string(kind)})
	toSecret := func(row dbgen.PlaidItemsDueRow) *accounts.PlaidItemSecret {
		item := PlaidItemSecretFromSQLRow(row)
		return &item
	}
	return dbutil.MapFirstRow(rows, err, toSecret)
}

func PlaidItemSecretFromSQLRow(row dbgen.PlaidItemsDueRow) accounts.PlaidItemSecret {
	item := row.PlaidItem
	return accounts.PlaidItemSecret{
		ID:                  item.ID,
		ExternalID:          item.ExternalID,
		CredentialID:        int32(item.CredentialID),
		AccessToken:         item.AccessToken,
		OwnerID:             row.OwnerID,
		OwnerName:           row.Owner,
		InstitutionID:       item.InstitutionID,
		InstitutionName:     row.InstitutionName,
		LogoURL:             item.LogoUrl,
		LastSyncedAt:        item.LastSyncedAt,
		SyncCron:            item.SyncCron,
		RecurringSyncCron:   item.RecurringSyncCron,
		NextSyncAt:          item.NextSyncAt,
		NextRecurringSyncAt: item.NextRecurringSyncAt,
		NextBalanceSyncAt:   item.NextBalanceSyncAt,
		InvestmentsEnabled:  item.PlaidInvestmentsEnabled,
		LiabilitiesEnabled:  item.PlaidLiabilitiesEnabled,
	}
}

func (s *Store) PlaidItemsMissingLogoURL(ctx context.Context) ([]accounts.PlaidItemSecret, error) {
	rows, err := s.q.PlaidItemsMissingLogoURL(ctx)
	fromRow := func(row dbgen.PlaidItemsMissingLogoURLRow) accounts.PlaidItemSecret {
		return accounts.PlaidItemSecret{
			ID:            row.ID,
			ExternalID:    row.ExternalID,
			CredentialID:  int32(row.CredentialID),
			InstitutionID: row.InstitutionID,
		}
	}
	return dbutil.MapRows(rows, err, fromRow)
}

func (s *Store) SetPlaidItemLogoURL(ctx context.Context, itemID int64, logoURL *string) error {
	return s.q.SetPlaidItemLogoURL(ctx, dbgen.SetPlaidItemLogoURLParams{LogoUrl: logoURL, ID: itemID})
}

func (s *Store) ResetItemSync(ctx context.Context, itemID int64) error {
	return s.q.ResetItemSync(ctx, dbgen.ResetItemSyncParams{ID: itemID})
}

func (s *Store) SetPlaidProductFlags(ctx context.Context, itemID int64, investmentsEnabled bool, liabilitiesEnabled bool) error {
	return s.q.SetPlaidProductFlags(ctx, dbgen.SetPlaidProductFlagsParams{
		ID:                      itemID,
		PlaidInvestmentsEnabled: investmentsEnabled,
		PlaidLiabilitiesEnabled: liabilitiesEnabled,
	})
}
