package wealth_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	u "tallyo/internal/utils"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

func TestAccountSnapshotResolvesLocalDayFromSyncedAt(t *testing.T) {
	ctx := u.ContextWithTimezone(context.Background(), "America/Los_Angeles")
	store := openWealthTestStore(t)
	account := createSnapshotEditorAccount(t, ctx, store, "snapshot-local-day")
	asset := createSnapshotEditorAsset(t, store, "LOCAL")

	quantity := 1.0
	replaceSnapshot := func(date, syncedAt string, price float64) {
		must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, wealth.AccountBalanceSnapshot{
			AccountID: account.ID.Int64(), Source: "plaid", Date: date, SyncedAt: syncedAt, BalanceUSD: money.Cents(price),
			Holdings: []wealth.AssetDailyHolding{{AssetID: asset.ID.Int64(), Quantity: &quantity, Price: &price, ValueUSD: price, CountsTowardValue: true}},
		}))
	}
	replaceSnapshot("2026-06-26", "2026-06-26T05:30:00Z", 125)
	replaceSnapshot("2026-06-27", "2026-06-27T05:30:00Z", 200)

	svc := &wealth.Service{Store: store, Log: test.Logger}
	accountID := account.ID
	localDate := model.Date("2026-06-25")
	snapshot, err := svc.AccountSnapshot(ctx, model.AccountSnapshotInput{AccountID: &accountID, Date: &localDate})
	must.NoErr(t, err)
	if snapshot == nil || snapshot.Date != "2026-06-25" || snapshot.BalanceUsd != 125 {
		t.Fatalf("snapshot = %#v, want local 2026-06-25 balance 125", snapshot)
	}

	localDate = model.Date("2026-06-26")
	snapshot, err = svc.AccountSnapshot(ctx, model.AccountSnapshotInput{AccountID: &accountID, Date: &localDate})
	must.NoErr(t, err)
	if snapshot == nil || snapshot.Date != "2026-06-26" || snapshot.BalanceUsd != 200 {
		t.Fatalf("snapshot = %#v, want local 2026-06-26 balance 200", snapshot)
	}

	missingDate := model.Date("2026-06-24")
	missing, err := svc.AccountSnapshot(ctx, model.AccountSnapshotInput{AccountID: &accountID, Date: &missingDate})
	must.NoErr(t, err)
	if missing != nil {
		t.Fatalf("missing snapshot = %#v, want nil", missing)
	}

	latest, err := svc.AccountSnapshot(ctx, model.AccountSnapshotInput{AccountID: &accountID})
	must.NoErr(t, err)
	if latest == nil || latest.Date != "2026-06-26" || latest.BalanceUsd != 200 {
		t.Fatalf("latest = %#v, want local 2026-06-26 balance 200", latest)
	}
}

func TestChangeAccountSnapshotUpdatesInPlaceAfterReviewResolved(t *testing.T) {
	ctx := u.ContextWithTimezone(context.Background(), "America/New_York")
	store := openWealthTestStore(t)
	account := createSnapshotEditorAccount(t, ctx, store, "snapshot-edit")
	security := createSnapshotEditorAsset(t, store, "EDIT")
	nonCounting := createSnapshotEditorAsset(t, store, "EXCL")
	cash := createSnapshotEditorCashAsset(t, store)
	quantity := 2.0
	price := 50.0
	nonCountingQuantity := 1.0
	nonCountingPrice := 75.0
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, wealth.AccountBalanceSnapshot{
		AccountID:  account.ID.Int64(),
		Source:     "plaid",
		Date:       "2026-06-26",
		SyncedAt:   "2026-06-26T15:00:00Z",
		BalanceUSD: 100,
		Flagged:    true,
		FlagReason: "spike",
		Holdings: []wealth.AssetDailyHolding{
			{
				AssetID:           security.ID.Int64(),
				Quantity:          &quantity,
				Price:             &price,
				ValueUSD:          100,
				CountsTowardValue: true,
			},
			{
				AssetID:           nonCounting.ID.Int64(),
				Quantity:          &nonCountingQuantity,
				Price:             &nonCountingPrice,
				ValueUSD:          75,
				CountsTowardValue: false,
			},
		},
	}))
	must.NoErr(t, store.UpsertBalanceReview(ctx, wealth.BalanceReviewUpsert{
		AccountID:              account.ID.Int64(),
		FirstFlaggedDate:       "2026-06-26",
		LatestFlaggedDate:      "2026-06-26",
		FlaggedSnapshotCount:   1,
		ProviderBalanceUSD:     125,
		CarryForwardBalanceUSD: 100,
		FlagReason:             "spike",
	}))

	svc := &wealth.Service{Store: store, Log: test.Logger}
	accountID := account.ID
	snapshot, err := svc.AccountSnapshot(ctx, model.AccountSnapshotInput{AccountID: &accountID})
	must.NoErr(t, err)
	if snapshot == nil {
		t.Fatal("AccountSnapshot returned nil")
	}
	zeroQty := 0.0
	cashQty := 25.0
	input := model.ChangeAccountSnapshotInput{
		SnapshotID: snapshot.ID,
		Holdings: []*model.SnapshotHoldingInput{
			{AssetID: security.ID, Quantity: &zeroQty, ValueUsd: 0},
			{AssetID: nonCounting.ID, Quantity: &nonCountingQuantity, ValueUsd: 80},
			{AssetID: cash.ID, Quantity: &cashQty, ValueUsd: 25},
		},
	}
	_, err = svc.ChangeAccountSnapshot(ctx, input)
	if err == nil || err.Error() != "resolve the pending balance review before editing snapshots" {
		t.Fatalf("ChangeAccountSnapshot() error = %v, want pending-review rejection", err)
	}
	reviews, err := store.ListInReviewBalanceReviews(ctx)
	must.NoErr(t, err)
	if len(reviews) != 1 {
		t.Fatalf("reviews = %#v, want one pending review", reviews)
	}
	must.NoErr(t, store.ApproveBalanceReview(ctx, reviews[0].ID))
	payload, err := svc.ChangeAccountSnapshot(ctx, input)
	must.NoErr(t, err)
	if payload.Snapshot.ID != snapshot.ID || payload.Snapshot.Flagged || payload.Snapshot.BalanceUsd != 25 {
		t.Fatalf("payload snapshot = %#v", payload.Snapshot)
	}
	if payload.Account.ID != account.ID {
		t.Fatalf("payload account = %#v, want %s", payload.Account, account.ID)
	}
	snapshotID := snapshot.ID.Int64()
	row, err := store.GetAccountBalanceSnapshotByID(ctx, snapshotID)
	if err != nil || row == nil {
		t.Fatalf("GetAccountBalanceSnapshotByID = %#v, %v", row, err)
	}
	if row.ID != snapshotID || row.Source != "plaid" || row.SyncedAt != "2026-06-26T15:00:00Z" || row.Flagged {
		t.Fatalf("row = %#v, want same id/source/synced_at and unflagged", row)
	}
	holdings, err := store.SnapshotHoldingsBySnapshotID(ctx, row.ID)
	must.NoErr(t, err)
	if len(holdings) != 3 {
		t.Fatalf("holdings = %#v, want three rows", holdings)
	}
	if !hasSnapshotHolding(holdings, security.ID.Int64(), 0, 0) {
		t.Fatalf("holdings = %#v, want zeroed security row", holdings)
	}
	if !hasSnapshotHolding(holdings, nonCounting.ID.Int64(), 1, 80) {
		t.Fatalf("holdings = %#v, want non-counting row", holdings)
	}
	if !hasSnapshotHolding(holdings, cash.ID.Int64(), 25, 25) {
		t.Fatalf("holdings = %#v, want cash row", holdings)
	}
	reviews, err = store.ListInReviewBalanceReviews(ctx)
	must.NoErr(t, err)
	if len(reviews) != 0 {
		t.Fatalf("reviews = %#v, want empty", reviews)
	}
}

func TestChangeAccountSnapshotManualSourceCarry(t *testing.T) {
	tests := map[string]struct {
		ownerName       string
		accountName     string
		externalID      string
		ticker          string
		secondQuantity  float64
		secondPrice     float64
		secondBalance   money.Cents
		secondValue     float64
		wantPropagation bool
	}{
		"flags and propagates pure carry": {
			ownerName: "manual-propagate-owner", accountName: "Manual Propagate", externalID: "manual-propagate", ticker: "MANP",
			secondQuantity: 2, secondPrice: 55, secondBalance: 110, secondValue: 110, wantPropagation: true,
		},
		"stops at divergent carry": {
			ownerName: "manual-diverge-owner", accountName: "Manual Diverge", externalID: "manual-diverge", ticker: "MAND",
			secondQuantity: 3, secondPrice: 50, secondBalance: money.FromDollars(150), secondValue: 150,
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			ctx := u.ContextWithTimezone(context.Background(), "UTC")
			store := openWealthTestStore(t)
			owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: tc.ownerName})
			account := &model.Account{Owner: owner, Name: tc.accountName, Type: model.AccountTypeInvestment, Manual: true}
			test.MustUpsertAccount(t, store, tc.externalID, account)
			asset := createSnapshotEditorAsset(t, store, tc.ticker)
			quantityTwo := 2.0
			price50 := 50.0
			secondQuantity := tc.secondQuantity
			secondPrice := tc.secondPrice
			for _, snapshot := range []wealth.AccountBalanceSnapshot{
				{
					AccountID: account.ID.Int64(), Source: syncerids.Manual.Str(), Date: "2026-06-01", SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: money.FromDollars(100),
					Holdings: []wealth.AssetDailyHolding{{AssetID: asset.ID.Int64(), Quantity: &quantityTwo, Price: &price50, ValueUSD: 100, CountsTowardValue: true, Manual: true}},
				},
				{
					AccountID: account.ID.Int64(), Source: syncerids.Manual.Str(), Date: "2026-06-02", SyncedAt: "2026-06-02T12:00:00Z", BalanceUSD: tc.secondBalance,
					Holdings: []wealth.AssetDailyHolding{{AssetID: asset.ID.Int64(), Quantity: &secondQuantity, Price: &secondPrice, ValueUSD: tc.secondValue, CountsTowardValue: true, Manual: true}},
				},
			} {
				must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, snapshot))
			}
			dayOne, err := store.LatestAccountBalanceSnapshotInWindow(ctx, account.ID.Int64(), "2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z")
			if err != nil || dayOne == nil {
				t.Fatalf("LatestAccountBalanceSnapshotInWindow(day one) = %#v, %v", dayOne, err)
			}
			svc := &wealth.Service{Store: store, Log: test.Logger}
			zeroQty := 0.0
			if _, err := svc.ChangeAccountSnapshot(ctx, model.ChangeAccountSnapshotInput{
				SnapshotID: model.New(model.GlobalIDSnapshot, dayOne.ID),
				Holdings:   []*model.SnapshotHoldingInput{{AssetID: asset.ID, Quantity: &zeroQty, ValueUsd: 0}},
			}); err != nil {
				t.Fatalf("ChangeAccountSnapshot: %v", err)
			}
			dayTwo, err := store.LatestAccountBalanceSnapshotInWindow(ctx, account.ID.Int64(), "2026-06-02T00:00:00Z", "2026-06-03T00:00:00Z")
			if err != nil || dayTwo == nil {
				t.Fatalf("LatestAccountBalanceSnapshotInWindow(day two) = %#v, %v", dayTwo, err)
			}
			holdings, err := store.SnapshotHoldingsBySnapshotID(ctx, dayTwo.ID)
			must.NoErr(t, err)
			if !tc.wantPropagation {
				if len(holdings) != 1 || holdings[0].Quantity == nil || *holdings[0].Quantity != 3 || holdings[0].ValueUSD != money.FromDollars(150) {
					t.Fatalf("day two holdings = %#v, want divergent row untouched", holdings)
				}
				return
			}
			if len(holdings) != 1 || holdings[0].Quantity == nil || *holdings[0].Quantity != 0 || holdings[0].ValueUSD != 0 || !holdings[0].Manual {
				t.Fatalf("day two holdings = %#v, want propagated zero manual holding", holdings)
			}
			latest, err := svc.AccountSnapshot(ctx, model.AccountSnapshotInput{AccountID: &account.ID})
			must.NoErr(t, err)
			if len(latest.Holdings) != 1 || !latest.Holdings[0].Manual {
				t.Fatalf("latest holdings = %#v, want manual flag", latest.Holdings)
			}
		})
	}
}

func TestChangeAccountSnapshotManualPropagationBatchesNewerHoldings(t *testing.T) {
	ctx := u.ContextWithTimezone(context.Background(), "UTC")
	base := openWealthTestStore(t)
	store := &countingSnapshotStore{wealthTestStore: base}
	owner := test.MustCreateOwner(t, base, model.CreateOwnerInput{Name: "manual-batch-owner"})
	account := &model.Account{Owner: owner, Name: "Manual Batch", Type: model.AccountTypeInvestment, Manual: true}
	test.MustUpsertAccount(t, base, "manual-batch", account)
	asset := createSnapshotEditorAsset(t, base, "BATCH")

	qtyTwo := 2.0
	qtyFour := 4.0
	price50 := 50.0
	price60 := 60.0
	for _, snapshot := range []wealth.AccountBalanceSnapshot{
		manualSnapshot(account.ID, asset.ID, "2026-06-01", qtyTwo, price50, money.FromDollars(100)),
		manualSnapshot(account.ID, asset.ID, "2026-06-02", qtyTwo, price50, money.FromDollars(100)),
		manualSnapshot(account.ID, asset.ID, "2026-06-03", qtyTwo, price60, money.FromDollars(100)),
		manualSnapshot(account.ID, asset.ID, "2026-06-04", qtyFour, price50, money.FromDollars(200)),
	} {
		must.NoErr(t, base.ReplaceAccountBalanceSnapshot(ctx, snapshot))
	}
	dayOne := mustSnapshotInWindow(t, ctx, base, account.ID, "2026-06-01")

	svc := &wealth.Service{Store: store, Log: test.Logger}
	qtyThree := 3.0
	_, err := svc.ChangeAccountSnapshot(ctx, model.ChangeAccountSnapshotInput{
		SnapshotID: model.New(model.GlobalIDSnapshot, dayOne.ID),
		Holdings:   []*model.SnapshotHoldingInput{{AssetID: asset.ID, Quantity: &qtyThree, ValueUsd: money.FromDollars(150)}},
	})
	must.NoErr(t, err)
	if store.singleHoldingReads != 2 || store.pluralHoldingReads != 1 {
		t.Fatalf("holding reads: single=%d plural=%d, want 2/1", store.singleHoldingReads, store.pluralHoldingReads)
	}

	assertSnapshotHolding(t, ctx, base, account.ID, "2026-06-02", 3, money.FromDollars(150), 50)
	assertSnapshotHolding(t, ctx, base, account.ID, "2026-06-03", 3, money.FromDollars(180), 60)
	assertSnapshotHolding(t, ctx, base, account.ID, "2026-06-04", 4, money.FromDollars(200), 50)
}

func createSnapshotEditorAccount(t *testing.T, _ context.Context, store *wealthTestStore, id string) *model.Account {
	t.Helper()
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: id + "-owner"})
	account := &model.Account{Owner: owner, Name: id, Type: model.AccountTypeInvestment}
	test.MustUpsertAccount(t, store, id, account)
	return account
}

func createSnapshotEditorAsset(t *testing.T, store *wealthTestStore, ticker string) *model.Asset {
	t.Helper()
	name := ticker + " Asset"
	return mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:          model.AssetTypeSecurity,
		Identifier:         ticker,
		Name:               &name,
		Classifier:         model.AssetClassifierPublic,
		TrackingTicker:     &ticker,
		TrackingMultiplier: 1,
	})
}

func createSnapshotEditorCashAsset(t *testing.T, store *wealthTestStore) *model.Asset {
	t.Helper()
	name := "US Dollar"
	return mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:          model.AssetTypeCurrency,
		Identifier:         "USD:snapshot-editor",
		Name:               &name,
		Classifier:         model.AssetClassifierCash,
		TrackingMultiplier: 1,
	})
}

func manualSnapshot(accountID, assetID model.GlobalID, date string, quantity float64, price float64, value money.Cents) wealth.AccountBalanceSnapshot {
	return wealth.AccountBalanceSnapshot{
		AccountID:  accountID.Int64(),
		Source:     syncerids.Manual.Str(),
		Date:       date,
		SyncedAt:   date + "T12:00:00Z",
		BalanceUSD: value,
		Holdings: []wealth.AssetDailyHolding{{
			AssetID:           assetID.Int64(),
			Quantity:          &quantity,
			Price:             &price,
			ValueUSD:          value.Dollars(),
			CountsTowardValue: true,
			Manual:            true,
		}},
	}
}

func mustSnapshotInWindow(t *testing.T, ctx context.Context, store *wealthTestStore, accountID model.GlobalID, date string) *wealth.SnapshotRow {
	t.Helper()
	row, err := store.LatestAccountBalanceSnapshotInWindow(ctx, accountID.Int64(), date+"T00:00:00Z", nextDate(t, date)+"T00:00:00Z")
	must.NoErr(t, err)
	if row == nil {
		t.Fatalf("missing snapshot for %s", date)
	}
	return row
}

func nextDate(t *testing.T, date string) string {
	t.Helper()
	parsed, err := time.Parse(time.DateOnly, date)
	must.NoErr(t, err)
	return parsed.AddDate(0, 0, 1).Format(time.DateOnly)
}

func assertSnapshotHolding(t *testing.T, ctx context.Context, store *wealthTestStore, accountID model.GlobalID, date string, quantity float64, value money.Cents, price float64) {
	t.Helper()
	row := mustSnapshotInWindow(t, ctx, store, accountID, date)
	holdings, err := store.SnapshotHoldingsBySnapshotID(ctx, row.ID)
	must.NoErr(t, err)
	if len(holdings) != 1 || holdings[0].Quantity == nil || holdings[0].Price == nil || *holdings[0].Quantity != quantity || holdings[0].ValueUSD != value || *holdings[0].Price != price {
		t.Fatalf("%s holdings = %#v", date, holdings)
	}
}

type countingSnapshotStore struct {
	*wealthTestStore
	singleHoldingReads int
	pluralHoldingReads int
}

func (s *countingSnapshotStore) SnapshotHoldingsBySnapshotID(ctx context.Context, snapshotID int64) ([]wealth.SnapshotHolding, error) {
	s.singleHoldingReads++
	return s.wealthTestStore.SnapshotHoldingsBySnapshotID(ctx, snapshotID)
}

func (s *countingSnapshotStore) SnapshotHoldingsBySnapshotIDs(ctx context.Context, snapshotIDs []int64) (map[int64][]wealth.SnapshotHolding, error) {
	s.pluralHoldingReads++
	return s.wealthTestStore.SnapshotHoldingsBySnapshotIDs(ctx, snapshotIDs)
}

func hasSnapshotHolding(holdings []wealth.SnapshotHolding, assetID int64, quantity float64, valueUSD money.Cents) bool {
	matches := func(holding wealth.SnapshotHolding) bool {
		return holding.Asset.ID.Int64() == assetID && holding.Quantity != nil && *holding.Quantity == quantity && holding.ValueUSD == valueUSD
	}
	return slices.ContainsFunc(holdings, matches)
}
