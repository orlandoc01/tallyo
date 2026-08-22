package wealthdb

import (
	"context"
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

func TestRealEstateLifecycle(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)

	owner := test.MustCreateOwner(t, store.accounts, model.CreateOwnerInput{Name: "home-owner"})

	street := "123 Main St"
	created, err := store.CreateRealEstate(ctx, wealth.CreateRealEstateInput{
		OwnerID: owner.ID.Int64(),
		Label:   "SF Condo",
		Details: wealth.RealEstateDetails{Street: &street, City: new("Testville"), State: new("TS"), Zip: new("11111")},
	})
	must.NoErr(t, err)
	conn, account := created.Connection, created.Account
	if conn.SourceTable != "assets" {
		t.Fatalf("connection source_table = %q, want assets", conn.SourceTable)
	}

	// 1:1 invariant: connection → asset → exactly one account.
	re, err := store.RealEstateByConnectionID(ctx, conn.ID.Int64())
	if err != nil || re == nil {
		t.Fatalf("RealEstateByConnectionID: %v (re=%v)", err, re)
	}
	accountLocalID := account.ID.Int64()
	if re.AccountID != accountLocalID {
		t.Fatalf("real estate mismatch: %#v", re)
	}
	// Account type must be PROPERTY and address must be persisted.
	if account.Type != model.AccountTypeProperty {
		t.Fatalf("account type = %q, want PROPERTY", account.Type)
	}
	if re.Details.Street == nil || *re.Details.Street != street {
		t.Fatalf("real estate address street = %v, want %q", re.Details.Street, street)
	}
	homes, err := store.ActiveRealEstate(ctx)
	if err != nil || len(homes) != 1 {
		t.Fatalf("ActiveRealEstate = %d, %v; want 1", len(homes), err)
	}

	// Closing the linked account excludes the home from periodic sync (the
	// shared snapshot sink would reject the write anyway), but the by-connection
	// lookup used for editing/deleting still finds it.
	closed := true
	if _, err := store.UpdateAccount(ctx, accountLocalID, model.UpdateAccountInput{Closed: &closed}); err != nil {
		t.Fatalf("UpdateAccount(closed): %v", err)
	}
	homes, err = store.ActiveRealEstate(ctx)
	if err != nil || len(homes) != 0 {
		t.Fatalf("ActiveRealEstate(closed account) = %d, %v; want 0", len(homes), err)
	}
	if re, err := store.RealEstateByConnectionID(ctx, conn.ID.Int64()); err != nil || re == nil {
		t.Fatalf("RealEstateByConnectionID(closed account) = %v, %v; want non-nil", re, err)
	}
	reopened := false
	if _, err := store.UpdateAccount(ctx, accountLocalID, model.UpdateAccountInput{Closed: &reopened}); err != nil {
		t.Fatalf("UpdateAccount(reopen): %v", err)
	}
	homes, err = store.ActiveRealEstate(ctx)
	if err != nil || len(homes) != 1 {
		t.Fatalf("ActiveRealEstate(reopened account) = %d, %v; want 1", len(homes), err)
	}

	// Shared asset snapshots + holdings.
	quantity := 1.0
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  accountLocalID,
		Date:       "2026-05-25",
		SyncedAt:   "2026-05-25T12:00:00Z",
		BalanceUSD: money.FromDollars(1442100),
		Source:     "realestate",
		Holdings: []wealth.AssetDailyHolding{{
			AssetID:           re.AssetID,
			Quantity:          &quantity,
			Price:             new(float64(1442100)),
			ValueUSD:          1442100,
			CountsTowardValue: true,
		}},
	})
	// Idempotent replacement on (account_id, source, date).
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  accountLocalID,
		Date:       "2026-05-25",
		SyncedAt:   "2026-05-25T13:00:00Z",
		BalanceUSD: money.FromDollars(1450000),
		Source:     "realestate",
		Holdings: []wealth.AssetDailyHolding{{
			AssetID:           re.AssetID,
			Quantity:          &quantity,
			Price:             new(float64(1450000)),
			ValueUSD:          1450000,
			CountsTowardValue: true,
		}},
	})

	holdings, err := store.CurrentHoldings(ctx, wealth.AccountFilter{})
	if err != nil || len(holdings) != 1 {
		t.Fatalf("CurrentHoldings = %d, %v; want 1", len(holdings), err)
	}
	if holdings[0].ValueUSD != money.FromDollars(1450000) || holdings[0].Asset.Classifier != model.AssetClassifierRealEstate {
		t.Fatalf("holding = %#v", holdings[0])
	}

	values := snapshotValuesOnDate(t, ctx, store, "2026-05-25", wealth.AccountFilter{})
	if len(values) != 1 || snapshotBalance(values) != money.FromDollars(1450000) {
		t.Fatalf("snapshot values = %#v, want one 1450000 total", values)
	}
	timestampRange, err := store.AccountBalanceSnapshotTimestampRange(ctx, wealth.AccountFilter{})
	if err != nil || timestampRange.Earliest == nil {
		t.Fatalf("AccountBalanceSnapshotTimestampRange().Earliest = %v, %v", timestampRange.Earliest, err)
	}

	// Unlink cleans everything up.
	must.NoErr(t, store.DeleteRealEstate(ctx, conn.ID.Int64()))
	homes, err = store.ActiveRealEstate(ctx)
	if err != nil || len(homes) != 0 {
		t.Fatalf("ActiveRealEstate after delete = %d, %v; want 0", len(homes), err)
	}
}

func TestUpdateRealEstate(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)

	owner := test.MustCreateOwner(t, store.accounts, model.CreateOwnerInput{Name: "update-owner"})
	created, err := store.CreateRealEstate(ctx, wealth.CreateRealEstateInput{
		OwnerID: owner.ID.Int64(),
		Label:   "Old Name",
		Details: wealth.RealEstateDetails{Street: new("1 Old St")},
	})
	must.NoErr(t, err)
	conn := created.Connection

	newName := "New Name"
	newStreet := "2 New St"
	newCity := "Newtown"
	_, err = store.UpdateRealEstate(ctx, wealth.UpdateRealEstateInput{
		ConnectionID: conn.ID.Int64(),
		Name:         &newName,
		Details: wealth.RealEstateDetails{
			Street: &newStreet,
			City:   &newCity,
		},
	})
	must.NoErr(t, err)

	re, err := store.RealEstateByConnectionID(ctx, conn.ID.Int64())
	if err != nil || re == nil {
		t.Fatalf("RealEstateByConnectionID after update: %v", err)
	}
	if re.Name != newName {
		t.Fatalf("name = %q, want %q", re.Name, newName)
	}
	if re.Details.Street == nil || *re.Details.Street != newStreet {
		t.Fatalf("street = %v, want %q", re.Details.Street, newStreet)
	}
	if re.Details.City == nil || *re.Details.City != newCity {
		t.Fatalf("city = %v, want %q", re.Details.City, newCity)
	}

	var assetName string
	var userEdited bool
	must.NoErr(t, store.db.SQL().QueryRowContext(ctx, `SELECT name, user_edited FROM assets WHERE id = ?`, re.AssetID).Scan(&assetName, &userEdited))
	if assetName != newName || !userEdited {
		t.Fatalf("asset name = %q user_edited = %v, want %q true", assetName, userEdited, newName)
	}
	var accountName string
	must.NoErr(t, store.db.SQL().QueryRowContext(ctx, `SELECT name FROM accounts WHERE id = ?`, re.AccountID).Scan(&accountName))
	if accountName != newName {
		t.Fatalf("account name = %q, want %q", accountName, newName)
	}
	var connectionName string
	must.NoErr(t, store.db.SQL().QueryRowContext(ctx, `SELECT name FROM connections WHERE id = ?`, conn.ID.Int64()).Scan(&connectionName))
	if connectionName != newName {
		t.Fatalf("connection name = %q, want %q", connectionName, newName)
	}
}

func TestUpsertAssetRealEstate(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)

	name := "Test Home"
	street := "456 Oak Ave"
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeRealEstate,
		Identifier: "real-estate-22222",
		Name:       &name,
		Classifier: model.AssetClassifierRealEstate,
		RealEstate: &wealth.RealEstateDetails{Street: &street},
	})
	if asset.AssetType != model.AssetTypeRealEstate || asset.Identifier != "real-estate-22222" {
		t.Fatalf("UpsertAsset = %#v", asset)
	}
	got, err := store.AssetByID(ctx, asset.ID.Int64())
	if err != nil || got == nil || got.Address == nil || got.Address.Street == nil || *got.Address.Street != "456 Oak Ave" {
		t.Fatalf("AssetByID: %v, got=%#v", err, got)
	}
}

func TestDeleteRealEstateNotFound(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	err := store.DeleteRealEstate(ctx, 999)
	if err == nil {
		t.Fatal("DeleteRealEstate(missing) should return error")
	}
}

func TestUpdateAssetNotFound(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	name := "Ghost"
	_, err := store.UpdateAsset(ctx, model.UpdateAssetInput{ID: model.New(model.GlobalIDAsset, 999999), Name: &name})
	if err == nil {
		t.Fatal("UpdateAsset(missing) should return error")
	}
}

func TestUpdateAssetName(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	name := "Original Name"
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "update-test-sym",
		Name:       &name,
		Classifier: model.AssetClassifierPublic,
	})
	updated := "Updated Name"
	got, err := store.UpdateAsset(ctx, model.UpdateAssetInput{ID: asset.ID, Name: &updated})
	must.NoErr(t, err)
	if got == nil || got.Name == nil || *got.Name != "Updated Name" {
		t.Fatalf("UpdateAsset name = %v, want Updated Name", got)
	}
}

func TestUpdateAssetSecurityFields(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	name := "Test Bond"
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "TESTBOND",
		Name:       &name,
		Classifier: model.AssetClassifierPublic,
	})
	cusip := "037833100"
	isin := "US0378331005"
	updatedIdentifier := "TESTBOND-UPDATED"
	got, err := store.UpdateAsset(ctx, model.UpdateAssetInput{
		ID:         asset.ID,
		Identifier: &updatedIdentifier,
		Security:   &model.UpdateSecurityAssetInput{Cusip: &cusip, Isin: &isin},
	})
	must.NoErr(t, err)
	if got == nil {
		t.Fatal("UpdateAsset returned nil")
	}
	if got.ID != asset.ID || got.Identifier != updatedIdentifier {
		t.Fatalf("updated asset = %#v, want id %s identifier %s", got, asset.ID, updatedIdentifier)
	}
	if got.Cusip == nil || *got.Cusip != cusip || got.Isin == nil || *got.Isin != isin {
		t.Fatalf("security metadata = %#v, want CUSIP %s ISIN %s", got, cusip, isin)
	}
}

func TestUpsertAssetPreservesUserEditedSecurityIdentifierByAdapterSource(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	name := "Apple Inc"
	plaidSecurityID := "sec-1"
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "AAPL",
		Name:          &name,
		Classifier:    model.AssetClassifierPublic,
		AdapterSource: &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: plaidSecurityID},
	})
	editedIdentifier := "MSFT"
	if _, err := store.UpdateAsset(ctx, model.UpdateAssetInput{ID: asset.ID, Identifier: &editedIdentifier}); err != nil {
		t.Fatalf("UpdateAsset: %v", err)
	}

	got := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "AAPL",
		Name:          &name,
		Classifier:    model.AssetClassifierPublic,
		AdapterSource: &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: plaidSecurityID},
	})
	if got.ID != asset.ID || got.Identifier != editedIdentifier {
		t.Fatalf("UpsertAsset returned %#v, want id %s identifier %s", got, asset.ID, editedIdentifier)
	}
}

func TestUpdateAssetCryptoFields(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	name := "Test Token"
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeCrypto,
		Identifier: "eth:test-token",
		Name:       &name,
		Classifier: model.AssetClassifierCryptocurrency,
	})
	got, err := store.AssetByID(ctx, asset.ID.Int64())
	must.NoErr(t, err)
	if got == nil {
		t.Fatal("AssetByID returned nil")
	}
}

func TestRevalueLatestAssetHoldings(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	owner := test.MustCreateOwner(t, store.accounts, model.CreateOwnerInput{Name: "revalue-owner"})
	street := "Revalue St"
	created, err := store.CreateRealEstate(ctx, wealth.CreateRealEstateInput{
		OwnerID: owner.ID.Int64(),
		Details: wealth.RealEstateDetails{Street: &street},
	})
	must.NoErr(t, err)
	account := created.Account
	homes, err := store.ActiveRealEstate(ctx)
	if err != nil || len(homes) == 0 {
		t.Fatalf("ActiveRealEstate: %v", err)
	}
	assetID := homes[0].AssetID
	quantity := 1.0
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: account.ID.Int64(), Source: "realestate", Date: "2026-06-01",
		SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: money.FromDollars(400000),
		Holdings: []wealth.AssetDailyHolding{{AssetID: assetID, Quantity: &quantity, ValueUSD: 400000, CountsTowardValue: true}},
	})
	must.NoErr(t, store.RevalueLatestAssetHoldings(ctx, assetID, 450000))
	holdings := mustCurrentHoldings(t, store, wealth.AccountFilter{AccountIDs: []int64{account.ID.Int64()}})
	if len(holdings) != 1 || holdings[0].Quantity == nil || *holdings[0].Quantity != 1 || holdings[0].ValueUSD != money.FromDollars(450000) {
		t.Fatalf("holdings = %#v, want known quantity revalued to 450000", holdings)
	}
}
