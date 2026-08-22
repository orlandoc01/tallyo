package wealthdb

import (
	"context"
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/wealth"
)

// The sweep is type-agnostic: any asset with no holding (current or historical),
// no manual holding, and no analysis report — and never user-edited — is junk
// and gets removed, regardless of asset_type. Held, edited, and analyzed assets
// are preserved.
func TestSweepUnreferencedAssetsRemovesUnreferencedOfAnyType(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	accountID := createCryptoAccount(t, ctx, store)

	mk := func(typ model.AssetType, ident string, cls model.AssetClassifier) *model.Asset {
		return mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: typ, Identifier: ident, Classifier: cls})
	}

	cryptoOrphan := mk(model.AssetTypeCrypto, "eth:0xorphan", model.AssetClassifierCryptocurrency)
	securityOrphan := mk(model.AssetTypeSecurity, "DEAD", model.AssetClassifierPublic)
	heldSecurity := mk(model.AssetTypeSecurity, "AAPL", model.AssetClassifierPublic)
	editedOrphan := mk(model.AssetTypeCrypto, "eth:0xedited", model.AssetClassifierCryptocurrency)
	reportedOrphan := mk(model.AssetTypeSecurity, "BND", model.AssetClassifierPublic)
	// CURRENCY is seeded reference data (the USD anchor) — never swept even unreferenced.
	currency := mk(model.AssetTypeCurrency, "EUR", model.AssetClassifierCash)

	// heldSecurity carries a holding -> preserved.
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: accountID, Source: "plaid", Date: "2026-06-01", SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: 100,
		Holdings: snapshotHoldings(heldSecurity.ID.Int64(), 100),
	})

	// editedOrphan is user-edited -> preserved even with no holding.
	editedID := editedOrphan.ID.Int64()
	if _, err := store.db.SQL().ExecContext(ctx, `UPDATE assets SET user_edited = 1 WHERE id = ?`, editedID); err != nil {
		t.Fatalf("mark user_edited: %v", err)
	}
	// reportedOrphan has an analysis report -> preserved (its FK is ON DELETE CASCADE).
	reportedID := reportedOrphan.ID.Int64()
	if _, err := store.db.SQL().ExecContext(ctx, `INSERT INTO asset_analysis_reports (asset_id, category, group_name) VALUES (?, 'Equity', 'Stocks')`, reportedID); err != nil {
		t.Fatalf("insert analysis report: %v", err)
	}

	removed, err := store.SweepUnreferencedAssets(ctx)
	if err != nil {
		t.Fatalf("SweepUnreferencedAssets: %v", err)
	}
	if removed != 2 {
		t.Fatalf("removed = %d, want 2 (crypto + security orphan)", removed)
	}

	for _, a := range []*model.Asset{heldSecurity, editedOrphan, reportedOrphan, currency} {
		got, err := store.AssetByID(ctx, a.ID.Int64())
		must.NoErr(t, err)
		if got == nil {
			t.Fatalf("asset %s was swept but should be preserved", a.Identifier)
		}
	}
	for _, a := range []*model.Asset{cryptoOrphan, securityOrphan} {
		got, err := store.AssetByID(ctx, a.ID.Int64())
		must.NoErr(t, err)
		if got != nil {
			t.Fatalf("orphan %s should have been swept", a.Identifier)
		}
	}
}
