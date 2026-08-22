package wealthdb

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

// check-codegen keeps dbgen in sync with the sqlc source files, so plan
// assertions on them cover the SQL that ships instead of a drifting copy.
func shippedQuery(t *testing.T, file, name string) string {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("..", "..", "database", "queries", file))
	must.NoErr(t, err)
	_, tail, found := strings.Cut(string(content), "-- name: "+name+" ")
	if !found {
		t.Fatalf("query %q not found in %s", name, file)
	}
	_, tail, _ = strings.Cut(tail, "\n")
	query, _, _ := strings.Cut(tail, ";")
	return query
}

func TestUseProviderBalanceReviewDoesNotRegressCatalogPrice(t *testing.T) {
	ctx := context.Background()
	store, accountID := newBalanceReviewFixture(t)
	trackingTicker := "SPY"
	newPrice := 200.0
	newPriceAt := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	newMultiplier := 2.0
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:          model.AssetTypeSecurity,
		Identifier:         "RESTORE-PRICE",
		Classifier:         model.AssetClassifierPublic,
		TrackingTicker:     &trackingTicker,
		TrackingMultiplier: newMultiplier,
		LastPrice:          &newPrice,
		LastPriceAt:        &newPriceAt,
	})
	oldPrice := 100.0
	oldPriceAt := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	oldMultiplier := 0.5
	quantity := 3.0
	holdingsJSON, err := wealth.MarshalBalanceReviewProviderHoldings([]wealth.AssetDailyHolding{{
		Asset: &wealth.AssetUpsert{
			AssetType:   model.AssetTypeSecurity,
			Identifier:  "RESTORE-PRICE",
			Classifier:  model.AssetClassifierPublic,
			LastPrice:   &oldPrice,
			LastPriceAt: &oldPriceAt,
		},
		PriceUpdate: &wealth.AssetUpdate{
			Price:              oldPrice,
			PriceAt:            oldPriceAt,
			TrackingMultiplier: &oldMultiplier,
		},
		Quantity:          &quantity,
		Price:             &oldPrice,
		ValueUSD:          300,
		CountsTowardValue: true,
	}})
	must.NoErr(t, err)
	persistFlaggedProviderSnapshot(t, store, accountID, *holdingsJSON)
	reviews := mustListInReviewBalanceReviews(t, store)
	must.NoErr(t, store.UseProviderBalanceReview(ctx, reviews[0].ID))

	current := mustAssetByID(t, store, asset.ID.Int64())
	priceRegressed := current.CurrentPrice == nil || *current.CurrentPrice != newPrice
	priceTimeRegressed := current.CurrentPriceAt == nil || !current.CurrentPriceAt.Equal(newPriceAt)
	if priceRegressed || priceTimeRegressed || current.TrackingMultiplier != newMultiplier {
		t.Fatalf("asset after restore = %#v", current)
	}
	restored, err := store.LatestUnflaggedSnapshotWithHoldings(ctx, accountID, "2026-07-02")
	must.NoErr(t, err)
	if restored.AmountUSD != 300 || len(restored.Holdings) != 1 || restored.Holdings[0].ValueUSD != 300 {
		t.Fatalf("restored snapshot = %#v", restored)
	}
}

func TestApproveBalanceReviewDeletesProviderStates(t *testing.T) {
	ctx := context.Background()
	store, accountID := newBalanceReviewFixture(t)
	persistFlaggedProviderSnapshot(t, store, accountID, "[]")
	if got := providerStateCountForAccount(t, store, accountID); got != 1 {
		t.Fatalf("provider states before approve = %d, want 1", got)
	}
	reviews := mustListInReviewBalanceReviews(t, store)
	must.NoErr(t, store.ApproveBalanceReview(ctx, reviews[0].ID))
	if got := providerStateCountForAccount(t, store, accountID); got != 0 {
		t.Fatalf("provider states after approve = %d, want 0", got)
	}
}

func TestCleanSnapshotDeletesReviewAndProviderStates(t *testing.T) {
	store, accountID := newBalanceReviewFixture(t)
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: accountID,
		Source:    syncerids.Plaid.Str(),
		Date:      "2026-06-30",
		SyncedAt:  "2026-06-30T12:00:00Z",
	})
	persistFlaggedProviderSnapshot(t, store, accountID, "[]")
	if got := providerStateCountForAccount(t, store, accountID); got != 1 {
		t.Fatalf("provider states before recovery = %d, want 1", got)
	}
	persistCleanSnapshot(t, store, accountID, "2026-07-02", &wealth.SnapshotRecovery{
		AccountID:  accountID,
		AfterDate:  "2026-06-30",
		BeforeDate: "2026-07-02",
	})
	if got := providerStateCountForAccount(t, store, accountID); got != 0 {
		t.Fatalf("provider states after recovery = %d, want 0", got)
	}
	reviews := mustListInReviewBalanceReviews(t, store)
	if len(reviews) != 0 {
		t.Fatalf("reviews after recovery = %#v, want none", reviews)
	}
}

func TestCleanSnapshotWithoutRecoveryExpiresApprovedReviewAndProviderStates(t *testing.T) {
	ctx := context.Background()
	store, accountID := newBalanceReviewFixture(t)
	persistFlaggedProviderSnapshot(t, store, accountID, "[]")
	reviews := mustListInReviewBalanceReviews(t, store)
	must.NoErr(t, store.ApproveBalanceReview(ctx, reviews[0].ID))
	approved, err := store.GetApprovedBalanceReviewByAccount(ctx, accountID)
	must.NoErr(t, err)
	if approved == nil {
		t.Fatal("approved review = nil")
	}
	insertProviderStateForDate(t, store, accountID, "2026-07-01")

	persistCleanSnapshot(t, store, accountID, "2026-07-02", nil)
	approved, err = store.GetApprovedBalanceReviewByAccount(ctx, accountID)
	must.NoErr(t, err)
	if approved != nil {
		t.Fatalf("approved review after clean = %#v, want nil", approved)
	}
	if got := providerStateCountForAccount(t, store, accountID); got != 0 {
		t.Fatalf("provider states after clean = %d, want 0", got)
	}
}

func TestApprovedCarryForwardSnapshotsDoNotPersistProviderStates(t *testing.T) {
	ctx := context.Background()
	store, accountID := newBalanceReviewFixture(t)
	for _, date := range []string{"2026-07-01", "2026-07-02"} {
		must.NoErr(t, store.PersistSnapshot(ctx, wealth.SnapshotPersist{
			SyncedAt: test.DateTime(date + "T12:00:00Z"),
			Snapshot: wealth.AccountBalanceSnapshot{
				AccountID:  accountID,
				Source:     syncerids.Plaid.Str(),
				Date:       date,
				SyncedAt:   date + "T12:00:00Z",
				BalanceUSD: 100,
				Flagged:    true,
				FlagReason: "spike",
			},
		}))
	}
	if got := providerStateCountForAccount(t, store, accountID); got != 0 {
		t.Fatalf("provider states = %d, want 0", got)
	}
}

func TestProviderStateDateRanges(t *testing.T) {
	db := testDB(t).db.SQL()
	bindParams := strings.NewReplacer("@account_id", "1", "@inclusive", "1", "@after_date", "'2026-07-01'", "@before_date", "'2026-07-03'")
	unflag := bindParams.Replace(shippedQuery(t, "account_balance_snapshots.sql", "UnflagSnapshotsBetweenDates"))
	dbtest.AssertQueryPlanUses(t, db, "EXPLAIN QUERY PLAN\n"+unflag, "account_id=?", "date>?", "date<?")
	deleteStates := bindParams.Replace(shippedQuery(t, "balance_review_provider_states.sql", "DeleteSnapshotProviderStatesBetweenDates"))
	dbtest.AssertQueryPlanUses(t, db, "EXPLAIN QUERY PLAN\n"+deleteStates, "account_id=?", "date>?", "date<?")

	for _, tc := range []struct {
		name            string
		dates           []string
		afterDate       string
		beforeDate      string
		inclusive       bool
		unflagSnapshots bool
		wantFlag        bool
		wantState       int64
	}{
		{
			name:       "inclusive keeps outside dates",
			dates:      []string{"2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"},
			afterDate:  "2026-07-01",
			beforeDate: "2026-07-03",
			inclusive:  true,
			wantState:  2,
		},
		{
			name:            "inclusive equal endpoints",
			dates:           []string{"2026-07-01"},
			afterDate:       "2026-07-01",
			beforeDate:      "2026-07-01",
			inclusive:       true,
			unflagSnapshots: true,
			wantFlag:        false,
			wantState:       0,
		},
		{
			name:            "exclusive equal endpoints",
			dates:           []string{"2026-07-01"},
			afterDate:       "2026-07-01",
			beforeDate:      "2026-07-01",
			inclusive:       false,
			unflagSnapshots: true,
			wantFlag:        true,
			wantState:       1,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			store, accountID := newBalanceReviewFixture(t)
			for _, date := range tc.dates {
				mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
					AccountID: accountID,
					Source:    syncerids.Plaid.Str(),
					Date:      date,
					SyncedAt:  date + "T12:00:00Z",
					Flagged:   tc.unflagSnapshots,
				})
				insertProviderStateForDate(t, store, accountID, date)
			}

			if tc.unflagSnapshots {
				must.NoErr(t, store.q.UnflagSnapshotsBetweenDates(ctx, dbgen.UnflagSnapshotsBetweenDatesParams{
					AccountID:  accountID,
					AfterDate:  tc.afterDate,
					BeforeDate: tc.beforeDate,
					Inclusive:  tc.inclusive,
				}))
			}
			must.NoErr(t, store.q.DeleteSnapshotProviderStatesBetweenDates(ctx, dbgen.DeleteSnapshotProviderStatesBetweenDatesParams{
				AccountID:  accountID,
				Inclusive:  tc.inclusive,
				AfterDate:  &tc.afterDate,
				BeforeDate: &tc.beforeDate,
			}))
			if !tc.unflagSnapshots {
				if got := providerStateCountForAccount(t, store, accountID); got != tc.wantState {
					t.Fatalf("provider states after inclusive range delete = %d, want 2", got)
				}
				return
			}

			var flagged bool
			must.NoErr(t, store.db.SQL().QueryRowContext(ctx, `SELECT flagged FROM account_balance_daily_snapshots WHERE account_id = ?`, accountID).Scan(&flagged))
			if flagged != tc.wantFlag || providerStateCountForAccount(t, store, accountID) != tc.wantState {
				t.Fatalf("equal endpoint result = flagged %t, provider states %d", flagged, providerStateCountForAccount(t, store, accountID))
			}
		})
	}
}

func TestPersistSnapshotRejectsInvalidRecoveryDates(t *testing.T) {
	store, accountID := newBalanceReviewFixture(t)
	err := store.PersistSnapshot(context.Background(), wealth.SnapshotPersist{
		SyncedAt: test.DateTime("2026-07-02T12:00:00Z"),
		Snapshot: wealth.AccountBalanceSnapshot{
			AccountID: accountID,
			Source:    syncerids.Plaid.Str(),
			Date:      "2026-07-02",
			SyncedAt:  "2026-07-02T12:00:00Z",
		},
		Recovery: &wealth.SnapshotRecovery{AccountID: accountID, AfterDate: "", BeforeDate: "2026-07-02"},
	})
	if err == nil || !strings.Contains(err.Error(), "recovery after date") {
		t.Fatalf("PersistSnapshot() error = %v, want recovery after date parse failure", err)
	}
}

func TestDeleteBalanceReviewsModesKeepUnrelatedRows(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	_, first := mustInvestmentAccount(t, store, "delete-review-first", "delete-review-first-owner", "delete-review-first")
	_, second := mustInvestmentAccount(t, store, "delete-review-second", "delete-review-second-owner", "delete-review-second")
	upsertTestReview(t, store, first)
	upsertTestReview(t, store, second)

	inReview := "IN_REVIEW"
	must.NoErr(t, store.q.DeleteBalanceReviewsByAccountID(ctx, dbgen.DeleteBalanceReviewsByAccountIDParams{AccountID: first, Decision: &inReview}))
	if got := balanceReviewCountForAccount(t, store, first); got != 0 {
		t.Fatalf("first IN_REVIEW reviews = %d, want 0", got)
	}
	if got := balanceReviewCountForAccount(t, store, second); got != 1 {
		t.Fatalf("second reviews after unrelated delete = %d, want 1", got)
	}
	_, err := store.db.SQL().ExecContext(ctx, `UPDATE account_balance_snapshot_reviews SET decision = 'APPROVED_CHANGES' WHERE account_id = ?`, second)
	must.NoErr(t, err)
	decision := "APPROVED_CHANGES"
	must.NoErr(t, store.q.DeleteBalanceReviewsByAccountID(ctx, dbgen.DeleteBalanceReviewsByAccountIDParams{AccountID: second, Decision: &decision}))
	if got := totalBalanceReviewCount(t, store); got != 0 {
		t.Fatalf("reviews after approved delete = %d, want 0", got)
	}
}

func persistFlaggedProviderSnapshot(
	t *testing.T,
	store *testStore,
	accountID int64,
	providerHoldingsJSON string,
) {
	t.Helper()
	flagReason := "spike"
	must.NoErr(t, store.PersistSnapshot(context.Background(), wealth.SnapshotPersist{
		SyncedAt: test.DateTime("2026-07-01T12:00:00Z"),
		Snapshot: wealth.AccountBalanceSnapshot{
			AccountID:  accountID,
			Source:     syncerids.Plaid.Str(),
			Date:       "2026-07-01",
			SyncedAt:   "2026-07-01T12:00:00Z",
			BalanceUSD: 100,
			Flagged:    true,
			FlagReason: flagReason,
		},
		ProviderState: &wealth.SnapshotProviderState{
			ProviderBalanceUSD:   300,
			ProviderHoldingsJSON: providerHoldingsJSON,
		},
		Review: &wealth.BalanceReviewUpsert{
			AccountID:              accountID,
			FirstFlaggedDate:       "2026-07-01",
			LatestFlaggedDate:      "2026-07-01",
			FlaggedSnapshotCount:   1,
			ProviderBalanceUSD:     300,
			CarryForwardBalanceUSD: 100,
			FlagReason:             flagReason,
		},
	}))
}

func newBalanceReviewFixture(t *testing.T) (*testStore, int64) {
	t.Helper()
	store := testDB(t)
	_, accountID := mustInvestmentAccount(t, store, "balance-review-account", "balance-review-owner", "Brokerage")
	return store, accountID
}

func persistCleanSnapshot(
	t *testing.T,
	store *testStore,
	accountID int64,
	date string,
	recovery *wealth.SnapshotRecovery,
) {
	t.Helper()
	must.NoErr(t, store.PersistSnapshot(context.Background(), wealth.SnapshotPersist{
		SyncedAt: test.DateTime(date + "T12:00:00Z"),
		Snapshot: wealth.AccountBalanceSnapshot{
			AccountID:  accountID,
			Source:     syncerids.Plaid.Str(),
			Date:       date,
			SyncedAt:   date + "T12:00:00Z",
			BalanceUSD: 100,
		},
		ExpireReview: true,
		Recovery:     recovery,
	}))
}

func insertProviderStateForDate(t *testing.T, store *testStore, accountID int64, date string) {
	t.Helper()
	snapshotID := snapshotIDByDate(t, store, accountID, date)
	_, err := store.db.SQL().ExecContext(context.Background(), `
INSERT INTO account_balance_snapshot_provider_states (
  snapshot_id,
  provider_balance_usd_cents,
  provider_holdings_json
) VALUES (?, 300, '[]')`, snapshotID)
	must.NoErr(t, err)
}

func upsertTestReview(t *testing.T, store *testStore, accountID int64) {
	t.Helper()
	must.NoErr(t, store.UpsertBalanceReview(context.Background(), wealth.BalanceReviewUpsert{
		AccountID:              accountID,
		FirstFlaggedDate:       "2026-07-01",
		LatestFlaggedDate:      "2026-07-01",
		FlaggedSnapshotCount:   1,
		ProviderBalanceUSD:     300,
		CarryForwardBalanceUSD: 100,
		FlagReason:             "spike",
	}))
}

func totalBalanceReviewCount(t *testing.T, store *testStore) int64 {
	t.Helper()
	var count int64
	must.NoErr(t, store.db.SQL().QueryRow(`SELECT COUNT(*) FROM account_balance_snapshot_reviews`).Scan(&count))
	return count
}

func balanceReviewCountForAccount(t *testing.T, store *testStore, accountID int64) int64 {
	t.Helper()
	var count int64
	must.NoErr(t, store.db.SQL().QueryRow(`SELECT COUNT(*) FROM account_balance_snapshot_reviews WHERE account_id = ?`, accountID).Scan(&count))
	return count
}

func providerStateCountForAccount(t *testing.T, store *testStore, accountID int64) int64 {
	t.Helper()
	var count int64
	must.NoErr(t, store.db.SQL().QueryRow(`
SELECT COUNT(*)
FROM account_balance_snapshot_provider_states ps
JOIN account_balance_daily_snapshots s ON s.id = ps.snapshot_id
WHERE s.account_id = ?`, accountID).Scan(&count))
	return count
}
