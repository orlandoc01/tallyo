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

func TestBalanceReviewUpsertApproveAndReplace(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	_, accountID := mustInvestmentAccount(t, store, "balance-review-account", "balance-review-owner", "Brokerage")
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "VTI", Classifier: model.AssetClassifierPublic})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: accountID, Source: "plaid", Date: "2026-06-14",
		SyncedAt: "2026-06-14T12:00:00Z", BalanceUSD: 100_000,
		Holdings: []wealth.AssetDailyHolding{{AssetID: asset.ID.Int64(), ValueUSD: 1000, CountsTowardValue: true}},
		Flagged:  true, FlagReason: "spike",
	})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: accountID, Source: "plaid", Date: "2026-06-15",
		SyncedAt: "2026-06-15T12:00:00Z", BalanceUSD: 100_000,
		Holdings: []wealth.AssetDailyHolding{{AssetID: asset.ID.Int64(), ValueUSD: 1000, CountsTowardValue: true}},
		Flagged:  true, FlagReason: "still spiking",
	})
	must.NoErr(t, store.UpsertBalanceReview(ctx, wealth.BalanceReviewUpsert{
		AccountID:              accountID,
		FirstFlaggedDate:       "2026-06-14",
		LatestFlaggedDate:      "2026-06-14",
		FlaggedSnapshotCount:   1,
		ProviderBalanceUSD:     1_000_000,
		CarryForwardBalanceUSD: 100_000,
		FlagReason:             "spike",
	}))
	must.NoErr(t, store.UpsertBalanceReview(ctx, wealth.BalanceReviewUpsert{
		AccountID:              accountID,
		FirstFlaggedDate:       "2026-06-15",
		LatestFlaggedDate:      "2026-06-15",
		FlaggedSnapshotCount:   1,
		ProviderBalanceUSD:     1_100_000,
		CarryForwardBalanceUSD: 100_000,
		FlagReason:             "still spiking",
	}))

	reviews := mustListInReviewBalanceReviews(t, store)
	if len(reviews) != 1 {
		t.Fatalf("reviews len = %d, want 1", len(reviews))
	}
	review := reviews[0]
	if review.FirstFlaggedDate != "2026-06-14" || review.LatestFlaggedDate != "2026-06-15" || review.FlaggedSnapshotCount != 2 {
		t.Fatalf("review date/count fields = %#v", review)
	}
	if review.Account == nil || review.Account.Name != "Brokerage" || review.Account.Owner == nil {
		t.Fatalf("review account = %#v", review.Account)
	}

	must.NoErr(t, store.ApproveBalanceReview(ctx, review.ID))
	approved, err := store.GetApprovedBalanceReviewByAccount(ctx, accountID)
	must.NoErr(t, err)
	if approved == nil || approved.ProviderBalanceUSD != 1_100_000 {
		t.Fatalf("approved review = %#v", approved)
	}
	reviews = mustListInReviewBalanceReviews(t, store)
	if len(reviews) != 0 {
		t.Fatalf("approved review still listed: %#v", reviews)
	}

	must.NoErr(t, store.UpsertBalanceReview(ctx, wealth.BalanceReviewUpsert{
		AccountID:              accountID,
		FirstFlaggedDate:       "2026-06-20",
		LatestFlaggedDate:      "2026-06-20",
		FlaggedSnapshotCount:   1,
		ProviderBalanceUSD:     2_000_000,
		CarryForwardBalanceUSD: 100_000,
		FlagReason:             "new anomaly",
	}))
	reviews = mustListInReviewBalanceReviews(t, store)
	if len(reviews) != 1 || reviews[0].FirstFlaggedDate != "2026-06-20" || reviews[0].FlaggedSnapshotCount != 1 {
		t.Fatalf("replacement review = %#v", reviews)
	}
}

func TestUseProviderBalanceReviewRestoresSnapshotsAndHoldings(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	_, accountID := mustInvestmentAccount(t, store, "balance-review-account", "balance-review-owner", "Brokerage")
	assetName := "Provider Asset"
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "VTI", Name: &assetName, Classifier: model.AssetClassifierPublic})
	quantity := 2.0
	price := 50.0
	providerQuantity := 5.0
	providerPrice := 60.0
	holdingsJSON, err := wealth.MarshalBalanceReviewProviderHoldings([]wealth.AssetDailyHolding{{
		AssetID:           asset.ID.Int64(),
		Quantity:          &providerQuantity,
		Price:             &providerPrice,
		ValueUSD:          300,
		CountsTowardValue: true,
	}})
	must.NoErr(t, err)
	must.NoErr(t, store.PersistSnapshot(ctx, wealth.SnapshotPersist{
		SyncedAt: test.DateTime("2026-06-19T16:00:00Z"),
		Snapshot: wealth.AccountBalanceSnapshot{
			AccountID:  accountID,
			Source:     "plaid",
			Date:       "2026-06-19",
			SyncedAt:   "2026-06-19T16:00:00Z",
			BalanceUSD: 100,
			Holdings: []wealth.AssetDailyHolding{{
				AssetID:           asset.ID.Int64(),
				Quantity:          &quantity,
				Price:             &price,
				ValueUSD:          100,
				CountsTowardValue: true,
			}},
			Flagged:    true,
			FlagReason: "empty holdings",
		},
		ProviderState: &wealth.SnapshotProviderState{
			ProviderBalanceUSD:   300,
			ProviderHoldingsJSON: *holdingsJSON,
		},
		Review: &wealth.BalanceReviewUpsert{
			AccountID:              accountID,
			FirstFlaggedDate:       "2026-06-19",
			LatestFlaggedDate:      "2026-06-19",
			FlaggedSnapshotCount:   1,
			ProviderBalanceUSD:     300,
			CarryForwardBalanceUSD: 100,
			FlagReason:             "empty holdings",
		},
	}))
	if got := providerStateCountForAccount(t, store, accountID); got != 1 {
		t.Fatalf("provider states before restore = %d, want 1", got)
	}
	reviews, err := store.ListInReviewBalanceReviews(ctx)
	if err != nil || len(reviews) != 1 {
		t.Fatalf("ListInReviewBalanceReviews = %#v, %v", reviews, err)
	}

	must.NoErr(t, store.UseProviderBalanceReview(ctx, reviews[0].ID))
	restored, err := store.LatestUnflaggedSnapshotWithHoldings(ctx, accountID, "2026-06-20")
	must.NoErr(t, err)
	if !restored.Found || restored.AmountUSD != 300 || restored.Date != "2026-06-19" {
		t.Fatalf("restored snapshot = %#v", restored)
	}
	if len(restored.Holdings) != 1 || restored.Holdings[0].ValueUSD != 300 || restored.Holdings[0].Quantity == nil || *restored.Holdings[0].Quantity != 5 {
		t.Fatalf("restored holdings = %#v", restored.Holdings)
	}
	if got := providerStateCountForAccount(t, store, accountID); got != 0 {
		t.Fatalf("provider states after restore = %d, want 0", got)
	}
	reviews = mustListInReviewBalanceReviews(t, store)
	if len(reviews) != 0 {
		t.Fatalf("review was not deleted: %#v", reviews)
	}
}

func TestUseProviderBalanceReviewUpsertsProviderAsset(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	accountID := createCryptoAccount(t, ctx, store)
	assetName := "Provider Token"
	quantity := 10.0
	price := 1.25
	holdingsJSON, err := wealth.MarshalBalanceReviewProviderHoldings([]wealth.AssetDailyHolding{{
		Asset: &wealth.AssetUpsert{
			AssetType:  model.AssetTypeCrypto,
			Identifier: "base:0xtoken",
			Name:       &assetName,
			Classifier: model.AssetClassifierStablecoin,
			AdapterSource: &wealth.AdapterSource{
				Adapter:  syncerids.Debank,
				SourceID: "base:0xtoken",
			},
		},
		Quantity:          &quantity,
		Price:             &price,
		ValueUSD:          12.5,
		CountsTowardValue: true,
	}})
	must.NoErr(t, err)
	must.NoErr(t, store.PersistSnapshot(ctx, wealth.SnapshotPersist{
		SyncedAt: test.DateTime("2026-07-01T12:00:00Z"),
		Snapshot: wealth.AccountBalanceSnapshot{
			AccountID:  accountID,
			Source:     syncerids.Debank.Str(),
			Date:       "2026-07-01",
			SyncedAt:   "2026-07-01T12:00:00Z",
			BalanceUSD: 5,
			Flagged:    true,
			FlagReason: "spike",
		},
		ProviderState: &wealth.SnapshotProviderState{
			ProviderBalanceUSD:   money.FromDollars(12.5),
			ProviderHoldingsJSON: *holdingsJSON,
		},
		Review: &wealth.BalanceReviewUpsert{
			AccountID:              accountID,
			FirstFlaggedDate:       "2026-07-01",
			LatestFlaggedDate:      "2026-07-01",
			FlaggedSnapshotCount:   1,
			ProviderBalanceUSD:     money.FromDollars(12.5),
			CarryForwardBalanceUSD: 5,
			FlagReason:             "spike",
		},
	}))
	reviews, err := store.ListInReviewBalanceReviews(ctx)
	if err != nil || len(reviews) != 1 {
		t.Fatalf("ListInReviewBalanceReviews = %#v, %v", reviews, err)
	}

	must.NoErr(t, store.UseProviderBalanceReview(ctx, reviews[0].ID))
	asset, err := store.AssetByKey(ctx, model.AssetTypeCrypto, "base:0xtoken")
	must.NoErr(t, err)
	if asset == nil || asset.Name == nil || *asset.Name != assetName {
		t.Fatalf("asset = %#v", asset)
	}
	restored, err := store.LatestUnflaggedSnapshotWithHoldings(ctx, accountID, "2026-07-02")
	must.NoErr(t, err)
	if len(restored.Holdings) != 1 || restored.Holdings[0].AssetID != asset.ID.Int64() || restored.Holdings[0].ValueUSD != 12.5 {
		t.Fatalf("restored holdings = %#v", restored.Holdings)
	}
}
