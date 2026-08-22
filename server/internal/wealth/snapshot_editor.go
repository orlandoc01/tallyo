package wealth

import (
	"context"
	"fmt"
	"time"

	"github.com/samber/lo"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	u "tallyo/internal/utils"
	"tallyo/internal/wealth/syncerids"
)

func (s *Service) AccountSnapshot(ctx context.Context, input model.AccountSnapshotInput) (*model.AccountSnapshot, error) {
	row, err := s.accountSnapshotRow(ctx, input)
	if err != nil || row == nil {
		return nil, err
	}
	return s.accountSnapshotModel(ctx, row)
}

func (s *Service) AccountLatestSnapshots(ctx context.Context, accountIDs []int64) (map[int64]*model.AccountSnapshot, error) {
	rowsByAccountID, err := s.Store.LatestAccountBalanceSnapshotsForAccounts(ctx, accountIDs)
	if err != nil {
		return nil, err
	}
	snapshotIDs := lo.MapToSlice(rowsByAccountID, func(_ int64, row *SnapshotRow) int64 { return row.ID })
	holdingsBySnapshotID, err := s.Store.SnapshotHoldingsBySnapshotIDs(ctx, snapshotIDs)
	if err != nil {
		return nil, err
	}
	snapshotsByAccountID := make(map[int64]*model.AccountSnapshot, len(rowsByAccountID))
	for accountID, row := range rowsByAccountID {
		snapshot, err := s.accountSnapshotModelFromParts(ctx, row, holdingsBySnapshotID[row.ID], row.AccountType)
		if err != nil {
			return nil, err
		}
		snapshotsByAccountID[accountID] = snapshot
	}
	return snapshotsByAccountID, nil
}

func (s *Service) ChangeAccountSnapshot(
	ctx context.Context,
	input model.ChangeAccountSnapshotInput,
) (*model.ChangeAccountSnapshotPayload, error) {
	snapshotID := input.SnapshotID.Int64()
	row, err := s.Store.GetAccountBalanceSnapshotByID(ctx, snapshotID)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, apierror.Publicf("snapshot %q not found", input.SnapshotID)
	}
	previousHoldings, err := s.Store.SnapshotHoldingsBySnapshotID(ctx, row.ID)
	if err != nil {
		return nil, err
	}
	toCountsByAsset := func(holding SnapshotHolding) (int64, bool) {
		return holding.Asset.ID.Int64(), holding.CountsTowardValue
	}
	countsByAsset := lo.SliceToMap(previousHoldings, toCountsByAsset)
	toAssetByID := func(holding SnapshotHolding) (int64, *model.Asset) {
		return holding.Asset.ID.Int64(), holding.Asset
	}
	assetsByID := lo.SliceToMap(previousHoldings, toAssetByID)
	holdings, err := snapshotEditHoldings(ctx, s.Store, input.Holdings, countsByAsset, assetsByID)
	if err != nil {
		return nil, err
	}
	manual := isManualSnapshotSource(row.Source)
	for i := range holdings {
		holdings[i].Manual = manual
	}
	edit := SnapshotEdit{
		ID:         row.ID,
		AccountID:  row.AccountID,
		Date:       row.Date,
		BalanceUSD: snapshotEditBalanceUSD(holdings),
		Holdings:   holdings,
	}
	edits := []SnapshotEdit{edit}
	if manual {
		propagatedEdits, err := s.propagatedManualSnapshotEdits(ctx, row, previousHoldings, holdings)
		if err != nil {
			return nil, err
		}
		edits = append(edits, propagatedEdits...)
	}
	if err := s.Store.UpdateAccountSnapshots(ctx, edits); err != nil {
		return nil, err
	}
	updated, err := s.Store.GetAccountBalanceSnapshotByID(ctx, row.ID)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, fmt.Errorf("snapshot %q not found after update", input.SnapshotID)
	}
	snapshot, err := s.accountSnapshotModel(ctx, updated)
	if err != nil {
		return nil, err
	}
	account, err := s.Store.AccountByID(ctx, row.AccountID)
	if err != nil {
		return nil, err
	}
	return &model.ChangeAccountSnapshotPayload{Snapshot: snapshot, Account: account}, nil
}

func (s *Service) accountSnapshotRow(
	ctx context.Context,
	input model.AccountSnapshotInput,
) (*SnapshotRow, error) {
	hasSnapshotID := input.SnapshotID != nil
	hasAccountID := input.AccountID != nil
	if hasSnapshotID == hasAccountID {
		return nil, apierror.Publicf("provide exactly one of snapshotId or accountId")
	}
	if input.SnapshotID != nil {
		return s.Store.GetAccountBalanceSnapshotByID(ctx, input.SnapshotID.Int64())
	}
	accountID := input.AccountID.Int64()
	if input.Date == nil {
		return s.Store.LatestAccountBalanceSnapshotForAccount(ctx, accountID)
	}
	startUTC, endUTC, err := localDateUTCWindow(*input.Date, u.TimezoneFromContext(ctx))
	if err != nil {
		return nil, err
	}
	return s.Store.LatestAccountBalanceSnapshotInWindow(
		ctx,
		accountID,
		startUTC.Format(time.RFC3339),
		endUTC.Format(time.RFC3339),
	)
}

func (s *Service) accountSnapshotModel(
	ctx context.Context,
	row *SnapshotRow,
) (*model.AccountSnapshot, error) {
	holdings, err := s.Store.SnapshotHoldingsBySnapshotID(ctx, row.ID)
	if err != nil {
		return nil, err
	}
	return s.accountSnapshotModelFromParts(ctx, row, holdings, row.AccountType)
}

func (s *Service) accountSnapshotModelFromParts(
	ctx context.Context,
	row *SnapshotRow,
	holdings []SnapshotHolding,
	accountType model.AccountType,
) (*model.AccountSnapshot, error) {
	syncedAt, err := time.Parse(time.RFC3339, row.SyncedAt)
	if err != nil {
		return nil, fmt.Errorf("parse snapshot synced_at %q: %w", row.SyncedAt, err)
	}
	netContribution := row.BalanceUSD
	if IsLiabilityType(accountType) {
		netContribution = -netContribution
	}
	return &model.AccountSnapshot{
		ID:                 model.New(model.GlobalIDSnapshot, row.ID),
		AccountID:          model.New(model.GlobalIDAccount, row.AccountID),
		Date:               model.Date(LocalDate(syncedAt, u.TimezoneFromContext(ctx))),
		BalanceUsd:         row.BalanceUSD,
		NetContributionUsd: netContribution,
		Holdings:           snapshotHoldingsToModel(holdings, row.AccountID),
		Flagged:            row.Flagged,
	}, nil
}

func snapshotEditHoldings(
	ctx context.Context,
	store SnapshotEditStore,
	inputs []*model.SnapshotHoldingInput,
	countsByAsset map[int64]bool,
	assetsByID map[int64]*model.Asset,
) ([]SnapshotEditHolding, error) {
	toSnapshotEditHolding := func(input *model.SnapshotHoldingInput) (SnapshotEditHolding, error) {
		assetID := input.AssetID.Int64()
		asset := assetsByID[assetID]
		if asset == nil {
			var err error
			asset, err = store.AssetByID(ctx, assetID)
			if err != nil {
				return SnapshotEditHolding{}, err
			}
		}
		if asset == nil {
			return SnapshotEditHolding{}, apierror.Publicf("asset %d not found", assetID)
		}
		quantity := input.Quantity
		var price *float64
		if asset.Classifier == model.AssetClassifierCash {
			cashPrice := 1.0
			price = &cashPrice
			if quantity == nil {
				value := input.ValueUsd.Dollars()
				quantity = &value
			}
		} else if quantity != nil && *quantity != 0 {
			derived := input.ValueUsd.Dollars() / *quantity
			price = &derived
		}
		countsTowardValue, ok := countsByAsset[assetID]
		if !ok {
			countsTowardValue = true
		}
		return SnapshotEditHolding{
			AssetID:           assetID,
			Quantity:          quantity,
			Price:             price,
			ValueUSD:          input.ValueUsd,
			CountsTowardValue: countsTowardValue,
		}, nil
	}
	return u.MapErr(inputs, toSnapshotEditHolding)
}

func snapshotEditBalanceUSD(holdings []SnapshotEditHolding) money.Cents {
	countsTowardValue := func(holding SnapshotEditHolding, _ int) bool {
		return holding.CountsTowardValue
	}
	valueUSD := func(holding SnapshotEditHolding) money.Cents { return holding.ValueUSD }
	return lo.SumBy(lo.Filter(holdings, countsTowardValue), valueUSD)
}

// snapshotHoldingsToModel converts stored historical holdings for one
// snapshot. Account is left nil (the Holding.account resolver loads it by
// AccountID) since this construction path only has the snapshot's account ID,
// not a joined Account.
func snapshotHoldingsToModel(holdings []SnapshotHolding, accountID int64) []*model.Holding {
	accountGlobalID := model.New(model.GlobalIDAccount, accountID)
	toHolding := func(holding SnapshotHolding) *model.Holding {
		return &model.Holding{
			AssetID:   holding.Asset.ID,
			Asset:     holding.Asset,
			AccountID: accountGlobalID,
			Quantity:  holding.Quantity,
			ValueUsd:  holding.ValueUSD,
			Manual:    holding.Manual,
		}
	}
	return u.Map(holdings, toHolding)
}

func (s *Service) propagatedManualSnapshotEdits(
	ctx context.Context,
	editedRow *SnapshotRow,
	previousHoldings []SnapshotHolding,
	editedHoldings []SnapshotEditHolding,
) ([]SnapshotEdit, error) {
	newerRows, err := s.Store.NewerAccountBalanceSnapshotsForAccount(
		ctx,
		editedRow.AccountID,
		editedRow.Date,
	)
	if err != nil {
		return nil, err
	}
	if len(newerRows) == 0 {
		return nil, nil
	}
	toSnapshotID := func(row *SnapshotRow) int64 { return row.ID }
	holdingsBySnapshotID, err := s.Store.SnapshotHoldingsBySnapshotIDs(ctx, u.Map(newerRows, toSnapshotID))
	if err != nil {
		return nil, err
	}
	previousBalance := editedRow.BalanceUSD
	editedBalance := snapshotEditBalanceUSD(editedHoldings)
	edits := []SnapshotEdit{}
	for _, newerRow := range newerRows {
		newerHoldings := holdingsBySnapshotID[newerRow.ID]
		if !isPureCarryForward(previousHoldings, previousBalance, newerHoldings, newerRow.BalanceUSD) {
			return edits, nil
		}
		propagatedHoldings := propagateHoldingsWithStoredPrices(editedHoldings, newerHoldings)
		balance := snapshotEditBalanceUSD(propagatedHoldings)
		if len(propagatedHoldings) == 0 {
			balance = editedBalance
		}
		edits = append(edits, SnapshotEdit{
			ID:         newerRow.ID,
			AccountID:  newerRow.AccountID,
			Date:       newerRow.Date,
			BalanceUSD: balance,
			Holdings:   propagatedHoldings,
		})
	}
	return edits, nil
}

func isPureCarryForward(previous []SnapshotHolding, previousBalance money.Cents, next []SnapshotHolding, nextBalance money.Cents) bool {
	if len(previous) == 0 && len(next) == 0 {
		return previousBalance == nextBalance
	}
	if len(previous) != len(next) {
		return false
	}
	toQuantityByAssetID := func(holding SnapshotHolding) (int64, *float64) {
		return holding.Asset.ID.Int64(), holding.Quantity
	}
	quantities := lo.SliceToMap(previous, toQuantityByAssetID)
	for _, holding := range next {
		quantity, ok := quantities[holding.Asset.ID.Int64()]
		if !ok || !equalQuantity(quantity, holding.Quantity) {
			return false
		}
	}
	return true
}

func equalQuantity(a, b *float64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func propagateHoldingsWithStoredPrices(edited []SnapshotEditHolding, carried []SnapshotHolding) []SnapshotEditHolding {
	toPriceByAssetID := func(holding SnapshotHolding) (int64, *float64) {
		return holding.Asset.ID.Int64(), holding.Price
	}
	pricesByAssetID := lo.SliceToMap(carried, toPriceByAssetID)
	propagate := func(holding SnapshotEditHolding) SnapshotEditHolding {
		price := pricesByAssetID[holding.AssetID]
		if price == nil {
			price = holding.Price
		}
		valueUSD := holding.ValueUSD
		if price != nil && holding.Quantity != nil {
			valueUSD = money.FromDollars(*holding.Quantity * *price)
		}
		return SnapshotEditHolding{
			AssetID:           holding.AssetID,
			Quantity:          holding.Quantity,
			Price:             price,
			ValueUSD:          valueUSD,
			CountsTowardValue: holding.CountsTowardValue,
			Manual:            holding.Manual,
		}
	}
	return u.Map(edited, propagate)
}

func isManualSnapshotSource(source string) bool {
	switch source {
	case syncerids.Manual.Str(), syncerids.RealEstate.Str():
		return true
	default:
		return false
	}
}

func localDateUTCWindow(date model.Date, tz string) (time.Time, time.Time, error) {
	loc := loadLoc(tz)
	localStart, err := time.ParseInLocation(time.DateOnly, string(date), loc)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("parse local date %q: %w", date, err)
	}
	localEnd := localStart.AddDate(0, 0, 1)
	return localStart.UTC(), localEnd.UTC(), nil
}
