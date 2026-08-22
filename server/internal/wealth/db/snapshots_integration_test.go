package wealthdb

import (
	"context"
	"testing"
	"time"

	"github.com/samber/lo"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

func TestReplaceAccountBalanceSnapshotIsIdempotent(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	accountID := createCryptoAccount(t, ctx, store)
	name := "Ethereum"
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeCrypto, Identifier: "eth:eth", Name: &name, Classifier: model.AssetClassifierCryptocurrency})
	snapshot := wealth.AccountBalanceSnapshot{
		AccountID:     accountID,
		WalletAddress: "0xabc",
		Source:        "debank",
		Date:          "2026-06-01",
		SyncedAt:      "2026-06-01T12:00:00Z",
		BalanceUSD:    money.FromDollars(2000),
		Holdings:      snapshotHoldings(asset.ID.Int64(), 2000),
	}
	mustReplaceSnapshot(t, store, snapshot)
	firstSnapshotID := snapshotIDByDate(t, store, accountID, snapshot.Date)
	insertProviderStateForDate(t, store, accountID, snapshot.Date)
	snapshot.BalanceUSD = money.FromDollars(2500)
	snapshot.Holdings[0].ValueUSD = 2500
	mustReplaceSnapshot(t, store, snapshot)
	secondSnapshotID := snapshotIDByDate(t, store, accountID, snapshot.Date)
	if secondSnapshotID == firstSnapshotID {
		t.Fatalf("replacement snapshot ID = %d, want a new row", secondSnapshotID)
	}
	if got := providerStateCountForAccount(t, store, accountID); got != 0 {
		t.Fatalf("provider states after replacement = %d, want 0", got)
	}
	holdings := mustCurrentHoldings(t, store, wealth.AccountFilter{})
	if len(holdings) != 1 || holdings[0].ValueUSD != money.FromDollars(2500) {
		t.Fatalf("latest holdings = %#v, want one updated 2500 holding", holdings)
	}
	values := snapshotValuesOnDate(t, ctx, store, "2026-06-01", wealth.AccountFilter{})
	if len(values) != 1 || snapshotBalance(values) != money.FromDollars(2500) {
		t.Fatalf("snapshot values = %#v, want one updated 2500 total", values)
	}
	timestampRange, err := store.AccountBalanceSnapshotTimestampRange(ctx, wealth.AccountFilter{AccountIDs: []int64{accountID, 999}})
	if err != nil || timestampRange.Earliest == nil {
		t.Fatalf("AccountBalanceSnapshotTimestampRange().Earliest = %v, %v", timestampRange.Earliest, err)
	}
	if timestampRange.Latest == nil {
		t.Fatalf("AccountBalanceSnapshotTimestampRange().Latest = %v, want non-nil", timestampRange.Latest)
	}
}

func TestLatestUnflaggedSnapshotWithHoldings(t *testing.T) {
	ctx := context.Background()
	quantity := 2.0
	price50 := 50.0
	price505 := 50.5
	price55 := 55.0
	store := testDB(t)
	_, accountID := mustInvestmentAccount(t, store, "invest", "latest-holdings-owner", "Brokerage")
	name := "Apple Inc"
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "AAPL", Name: &name, Classifier: model.AssetClassifierPublic})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: accountID, Source: "plaid", Date: "2026-06-01",
		SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: 100,
		Holdings: []wealth.AssetDailyHolding{{AssetID: asset.ID.Int64(), Quantity: &quantity, Price: &price50, ValueUSD: 100, CountsTowardValue: true}},
	})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: accountID, Source: "plaid", Date: "2026-06-02",
		SyncedAt: "2026-06-02T12:00:00Z", BalanceUSD: 101,
		Flagged: true, FlagReason: "bad day",
		Holdings: []wealth.AssetDailyHolding{{AssetID: asset.ID.Int64(), Quantity: &quantity, Price: &price505, ValueUSD: 101, CountsTowardValue: true}},
	})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: accountID, Source: "plaid", Date: "2026-06-03",
		SyncedAt: "2026-06-03T12:00:00Z", BalanceUSD: 110,
		Holdings: []wealth.AssetDailyHolding{{AssetID: asset.ID.Int64(), Quantity: &quantity, Price: &price55, ValueUSD: 110, CountsTowardValue: true}},
	})

	result, err := store.LatestUnflaggedSnapshotWithHoldings(ctx, accountID, "2026-06-03")
	must.NoErr(t, err)
	if !result.Found || result.Date != "2026-06-01" || result.AmountUSD != 100 {
		t.Fatalf("result = %#v", result)
	}
	if len(result.Holdings) != 1 || result.Holdings[0].AssetID != asset.ID.Int64() || result.Holdings[0].Identifier != "AAPL" || result.Holdings[0].Price == nil || *result.Holdings[0].Price != 50 {
		t.Fatalf("holdings = %#v", result.Holdings)
	}

	missing, err := store.LatestUnflaggedSnapshotWithHoldings(ctx, accountID, "2026-06-01")
	must.NoErr(t, err)
	if missing.Found {
		t.Fatalf("missing result = %#v, want not found", missing)
	}
}

func TestLatestUnflaggedSnapshotWithHoldingsDedupesSameAdapterSources(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	_, accountID := mustInvestmentAccount(t, store, "merged-invest", "latest-merged-owner", "Merged Brokerage")
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "AAPL",
		Classifier:    model.AssetClassifierPublic,
		AdapterSource: &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: "sec-aapl-old"},
	})
	mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "AAPL",
		Classifier:    model.AssetClassifierPublic,
		AdapterSource: &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: "sec-aapl-new"},
	})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: accountID, Source: syncerids.Plaid.Str(), Date: "2026-06-01",
		SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: 100,
		Holdings: snapshotHoldings(asset.ID.Int64(), 100),
	})

	result, err := store.LatestUnflaggedSnapshotWithHoldings(ctx, accountID, "2026-06-02")
	must.NoErr(t, err)
	if len(result.Holdings) != 1 || result.Holdings[0].ValueUSD != 100 {
		t.Fatalf("holdings = %#v, want one carried holding", result.Holdings)
	}
	if len(result.Holdings[0].AdapterSources) != 2 {
		t.Fatalf("adapter sources = %#v, want both aliases", result.Holdings[0].AdapterSources)
	}
}

func TestPersistSnapshotRollsBackReviewFailure(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	_, accountID := mustInvestmentAccount(t, store, "persist-rollback", "persist-rollback-owner", "Brokerage")
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "ROLL",
		Classifier: model.AssetClassifierPublic,
	})
	syncedAt := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	err := store.PersistSnapshot(ctx, wealth.SnapshotPersist{
		Snapshot: wealth.AccountBalanceSnapshot{
			AccountID:  accountID,
			Source:     "plaid",
			Date:       "2026-06-01",
			SyncedAt:   syncedAt.Format(time.RFC3339),
			BalanceUSD: money.FromDollars(100),
			Holdings:   snapshotHoldings(asset.ID.Int64(), 100),
		},
		SyncedAt: syncedAt,
		Review: &wealth.BalanceReviewUpsert{
			AccountID:              accountID + 9999,
			FirstFlaggedDate:       "2026-06-01",
			LatestFlaggedDate:      "2026-06-01",
			FlaggedSnapshotCount:   1,
			ProviderBalanceUSD:     money.FromDollars(100),
			CarryForwardBalanceUSD: money.FromDollars(90),
			FlagReason:             "forced failure",
		},
	})
	if err == nil {
		t.Fatal("PersistSnapshot() error = nil, want review FK failure")
	}
	rows, err := store.AccountBalanceSnapshotsPage(ctx, accountID, nil, 10)
	must.NoErr(t, err)
	if len(rows) != 0 {
		t.Fatalf("snapshots after rollback = %#v, want none", rows)
	}
	synced, err := store.AccountLastBalanceSyncedAtForAccounts(ctx, []int64{accountID})
	must.NoErr(t, err)
	if _, ok := synced[accountID]; ok {
		t.Fatalf("last synced = %v, want none after rollback", synced)
	}
}

func createCryptoAccount(t *testing.T, ctx context.Context, store *testStore) int64 {
	t.Helper()
	owner := test.MustCreateOwner(t, store.accounts, model.CreateOwnerInput{Name: "crypto-owner"})
	_, account, err := store.accounts.CreateEVMWallet(ctx, "0x1111111111111111111111111111111111111111", owner.ID.Int64(), "wallet", []string{"eth"})
	must.NoErr(t, err)
	return account.ID.Int64()
}

func snapshotHoldings(assetID int64, valueUSD float64) []wealth.AssetDailyHolding {
	return []wealth.AssetDailyHolding{{AssetID: assetID, ValueUSD: valueUSD, CountsTowardValue: true}}
}

func TestAccountBalanceSnapshotValuesReturnsRows(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	ownerID, accountID := mustInvestmentAccount(t, store, "invest", "values-owner", "Brokerage")
	name := "Apple Inc"
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "AAPL", Name: &name, Classifier: model.AssetClassifierPublic})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: accountID, Source: "plaid", Date: "2026-06-01",
		SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: 100,
		Holdings: snapshotHoldings(asset.ID.Int64(), 100),
	})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: accountID, Source: "plaid", Date: "2026-06-02",
		SyncedAt: "2026-06-01T13:00:00Z", BalanceUSD: 200,
		Holdings: snapshotHoldings(asset.ID.Int64(), 200),
	})
	values, err := store.AccountBalanceSnapshotValues(ctx, "2026-06-01T00:00:00Z", "2026-06-03T00:00:00Z", wealth.AccountFilter{})
	must.NoErr(t, err)
	if len(values) != 2 {
		t.Fatalf("AccountBalanceSnapshotValues = %d rows, want 2", len(values))
	}
	if values[0].AccountID != accountID || values[0].BalanceUSD != 100 {
		t.Fatalf("first value = %#v, want 100", values[0])
	}
	if values[1].AccountID != accountID || values[1].BalanceUSD != 200 {
		t.Fatalf("second value = %#v, want 200", values[1])
	}

	// Owner filter path.
	filtered, err := store.AccountBalanceSnapshotValues(ctx, "2026-06-01T00:00:00Z", "2026-06-03T00:00:00Z", wealth.AccountFilter{OwnerIDs: []int64{ownerID, 999}})
	must.NoErr(t, err)
	if len(filtered) != 2 {
		t.Fatalf("AccountBalanceSnapshotValues(owner) = %d rows, want 2", len(filtered))
	}
}

func TestReplaceAccountBalanceSnapshotRealEstateSupersedesRealEstate(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	owner := test.MustCreateOwner(t, store.accounts, model.CreateOwnerInput{Name: "re-owner"})
	street := "Test St"
	created, err := store.CreateRealEstate(ctx, wealth.CreateRealEstateInput{OwnerID: owner.ID.Int64(), Details: wealth.RealEstateDetails{Street: &street}})
	must.NoErr(t, err)
	conn, account := created.Connection, created.Account
	re, err := store.RealEstateByConnectionID(ctx, conn.ID.Int64())
	if err != nil || re == nil {
		t.Fatalf("RealEstateByConnectionID: %v", err)
	}
	quantity := 1.0
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: account.ID.Int64(), Source: "realestate", Date: "2026-06-01",
		SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: 500000,
		Holdings: []wealth.AssetDailyHolding{{AssetID: re.AssetID, Quantity: &quantity, ValueUSD: 500000, CountsTowardValue: true}},
	})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: account.ID.Int64(), Source: "realestate", Date: "2026-06-01",
		SyncedAt: "2026-06-01T13:00:00Z", BalanceUSD: 600000,
		Holdings: []wealth.AssetDailyHolding{{AssetID: re.AssetID, Quantity: &quantity, ValueUSD: 600000, CountsTowardValue: true}},
	})
	values, err := store.AccountBalanceSnapshotValues(ctx, "2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z", wealth.AccountFilter{})
	must.NoErr(t, err)
	if len(values) != 1 || values[0].BalanceUSD != 600000 {
		t.Fatalf("values = %#v, want single realestate 600000", values)
	}
	_ = store.DeleteRealEstate(ctx, conn.ID.Int64())
}

func TestHoldingsFilteredPaths(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)

	// Build a crypto account + snapshot so holdings queries return data.
	accountID := createCryptoAccount(t, ctx, store)

	owners, err := store.Owners(ctx)
	if err != nil || len(owners) == 0 {
		t.Fatalf("Owners: %v (len=%d)", err, len(owners))
	}
	owner := owners[0]

	name := "Bitcoin"
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeCrypto, Identifier: "btc:btc", Name: &name, Classifier: model.AssetClassifierCryptocurrency})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: accountID, Source: "debank", Date: "2026-06-01",
		SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: 1000,
		Holdings: snapshotHoldings(asset.ID.Int64(), 1000),
	})

	// CurrentHoldings with owner IDs covers latest-holding filtering.
	byOwner, err := store.CurrentHoldings(ctx, wealth.AccountFilter{OwnerIDs: []int64{owner.ID.Int64(), 999}})
	must.NoErr(t, err)
	if len(byOwner) != 1 {
		t.Fatalf("CurrentHoldings(ownerIDs) = %d, want 1", len(byOwner))
	}
	// AccountBalanceSnapshotCount covers the inspection function.
	count, err := store.AccountBalanceSnapshotCount(ctx, accountID)
	if err != nil || count != 1 {
		t.Fatalf("AccountBalanceSnapshotCount = %d, %v", count, err)
	}
}

func TestLiabilityAccountBalances(t *testing.T) {
	store := testDB(t)

	owner := test.MustCreateOwner(t, store.accounts, model.CreateOwnerInput{Name: "liability-owner"})

	// Credit-type account needed for ListLatestLiabilityAccountBalances query.
	creditAccount := &model.Account{Owner: owner, Name: "Visa", Type: model.AccountTypeCredit}
	test.MustUpsertAccount(t, store.accounts, "credit-acc", creditAccount)

	// Add a balance snapshot (no holdings needed for a credit account).
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: creditAccount.ID.Int64(), Source: "manual", Date: "2026-06-01",
		SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: -500,
	})

	// nil ownerIDs path covers liabilityBalances, liabilityBalance, liabilityCurrentHoldingRow.
	balances := mustLatestLiabilityAccountBalances(t, store, wealth.AccountFilter{})
	if len(balances) != 1 || balances[0].Account.Name != "Visa" {
		t.Fatalf("LatestLiabilityAccountBalances(nil) = %+v", balances)
	}

	// non-nil ownerIDs path covers liabilityBalancesByOwnerRows, liabilityCurrentHoldingByOwnerRow.
	byOwner := mustLatestLiabilityAccountBalances(t, store, wealth.AccountFilter{OwnerIDs: []int64{owner.ID.Int64(), 999}})
	if len(byOwner) != 1 {
		t.Fatalf("LatestLiabilityAccountBalances(ownerIDs) = %d, want 1", len(byOwner))
	}
}

func TestReplaceAccountBalanceSnapshotSkipsClosedAccount(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	owner := test.MustCreateOwner(t, store.accounts, model.CreateOwnerInput{Name: "closed-skip-owner"})
	account := &model.Account{Owner: owner, Name: "Closed", Type: model.AccountTypeInvestment, Closed: true}
	test.MustUpsertAccount(t, store.accounts, "closed-skip", account)
	accountID := account.ID.Int64()

	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  accountID,
		Source:     "plaid",
		Date:       "2026-06-01",
		SyncedAt:   "2026-06-01T12:00:00Z",
		BalanceUSD: 100,
	})
	count, err := store.AccountBalanceSnapshotCount(ctx, accountID)
	if err != nil || count != 0 {
		t.Fatalf("AccountBalanceSnapshotCount = %d, %v, want 0, nil", count, err)
	}
}

func TestCurrentSnapshotQueriesExcludeClosedAccounts(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	owner := test.MustCreateOwner(t, store.accounts, model.CreateOwnerInput{Name: "closed-current-owner"})
	investment := &model.Account{Owner: owner, Name: "Closed Brokerage", Type: model.AccountTypeInvestment}
	test.MustUpsertAccount(t, store.accounts, "closed-investment", investment)
	credit := &model.Account{Owner: owner, Name: "Closed Card", Type: model.AccountTypeCredit}
	test.MustUpsertAccount(t, store.accounts, "closed-credit", credit)
	assetName := "Apple Inc"
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "AAPL", Name: &assetName, Classifier: model.AssetClassifierPublic})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: investment.ID.Int64(), Source: "plaid", Date: "2026-06-01", SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: 100,
		Holdings: snapshotHoldings(asset.ID.Int64(), 100),
	})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{AccountID: credit.ID.Int64(), Source: "plaid", Date: "2026-06-01", SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: 50})
	closed := true
	if _, err := store.UpdateAccount(ctx, investment.ID.Int64(), model.UpdateAccountInput{Closed: &closed}); err != nil {
		t.Fatalf("UpdateAccount(investment): %v", err)
	}
	if _, err := store.UpdateAccount(ctx, credit.ID.Int64(), model.UpdateAccountInput{Closed: &closed}); err != nil {
		t.Fatalf("UpdateAccount(credit): %v", err)
	}

	holdings := mustCurrentHoldings(t, store, wealth.AccountFilter{})
	if len(holdings) != 0 {
		t.Fatalf("CurrentHoldings = %#v, want none", holdings)
	}
	balances := mustLatestLiabilityAccountBalances(t, store, wealth.AccountFilter{})
	if len(balances) != 0 {
		t.Fatalf("LatestLiabilityAccountBalances = %#v, want none", balances)
	}
	timestampRange, err := store.AccountBalanceSnapshotTimestampRange(ctx, wealth.AccountFilter{})
	must.NoErr(t, err)
	if timestampRange.Latest != nil {
		t.Fatalf("AccountBalanceSnapshotTimestampRange().Latest = %v, want nil", timestampRange.Latest)
	}
}

func TestManualSnapshotAccountIDsSelectsOpenManualAccounts(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	owner := test.MustCreateOwner(t, store.accounts, model.CreateOwnerInput{Name: "manual-discovery-owner"})
	open, err := store.accounts.CreateManualAccount(ctx, model.CreateManualAccountInput{
		Name:    "Open Manual",
		OwnerID: owner.ID,
		Type:    model.AccountTypeDepository,
	})
	must.NoErr(t, err)
	closed := true
	if _, err := store.accounts.CreateManualAccount(ctx, model.CreateManualAccountInput{
		Name:    "Closed Manual",
		OwnerID: owner.ID,
		Type:    model.AccountTypeDepository,
		Closed:  &closed,
	}); err != nil {
		t.Fatalf("CreateManualAccount(closed): %v", err)
	}
	provider := &model.Account{Owner: owner, Name: "Provider", Type: model.AccountTypeDepository}
	test.MustUpsertAccount(t, store.accounts, "provider", provider)

	ids, err := store.ManualSnapshotAccountIDs(ctx)
	must.NoErr(t, err)
	if len(ids) != 1 || ids[0] != open.ID.Int64() {
		t.Fatalf("ManualSnapshotAccountIDs = %#v, want [%d]", ids, open.ID.Int64())
	}
}

func snapshotValuesOnDate(t *testing.T, ctx context.Context, store *testStore, date string, filter wealth.AccountFilter) []wealth.SnapshotValue {
	t.Helper()
	start, err := time.Parse(time.DateOnly, date)
	must.NoErr(t, err)
	values, err := store.AccountBalanceSnapshotValues(
		ctx,
		start.Format(time.RFC3339),
		start.AddDate(0, 0, 1).Format(time.RFC3339),
		filter,
	)
	must.NoErr(t, err)
	return values
}

func snapshotBalance(values []wealth.SnapshotValue) money.Cents {
	toBalanceUSD := func(value wealth.SnapshotValue) money.Cents { return value.BalanceUSD }
	return lo.SumBy(values, toBalanceUSD)
}

func TestHistoricalSnapshotValueQueries(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)

	owner := test.MustCreateOwner(t, store.accounts, model.CreateOwnerInput{Name: "history-owner"})

	investment := &model.Account{Owner: owner, Name: "Brokerage", Type: model.AccountTypeInvestment}
	test.MustUpsertAccount(t, store.accounts, "history-invest", investment)
	credit := &model.Account{Owner: owner, Name: "Visa", Type: model.AccountTypeCredit}
	test.MustUpsertAccount(t, store.accounts, "history-credit", credit)
	mortgageSubtype := "mortgage"
	loan := &model.Account{Owner: owner, Name: "Mortgage", Type: model.AccountTypeLoan, Subtype: &mortgageSubtype}
	test.MustUpsertAccount(t, store.accounts, "history-loan", loan)
	manual, err := store.accounts.CreateManualAccount(ctx, model.CreateManualAccountInput{
		Name:    "Manual Liabilities",
		OwnerID: owner.ID,
		Type:    model.AccountTypeCredit,
	})
	must.NoErr(t, err)

	publicName := "Apple Inc"
	publicAsset := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "AAPL", Name: &publicName, Classifier: model.AssetClassifierPublic})
	cashName := "USD"
	cashAsset := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeCurrency, Identifier: "usd:test", Name: &cashName, Classifier: model.AssetClassifierCash})

	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID: investment.ID.Int64(), Source: "plaid", Date: "2026-06-01", SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: 350,
		Holdings: []wealth.AssetDailyHolding{
			{AssetID: publicAsset.ID.Int64(), ValueUSD: 250, CountsTowardValue: true},
			{AssetID: cashAsset.ID.Int64(), ValueUSD: 100, CountsTowardValue: true},
		},
	})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{AccountID: credit.ID.Int64(), Source: "plaid", Date: "2026-06-01", SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: -125})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{AccountID: loan.ID.Int64(), Source: "plaid", Date: "2026-06-01", SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: -500})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{AccountID: manual.ID.Int64(), Source: syncerids.Manual.Str(), Date: "2026-06-01", SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: -75})

	classifierValues, err := store.ClassifierSnapshotValues(ctx, "2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z", wealth.AccountFilter{})
	must.NoErr(t, err)
	if len(classifierValues) != 2 {
		t.Fatalf("ClassifierSnapshotValues(nil) = %d rows, want 2", len(classifierValues))
	}
	if classifierValues[0].Classifier != model.AssetClassifierCash || classifierValues[0].ValueUSD != money.FromDollars(100) {
		t.Fatalf("first classifier row = %#v, want cash 100", classifierValues[0])
	}
	if classifierValues[1].Classifier != model.AssetClassifierPublic || classifierValues[1].ValueUSD != money.FromDollars(250) {
		t.Fatalf("second classifier row = %#v, want public 250", classifierValues[1])
	}
	classifierByOwner, err := store.ClassifierSnapshotValues(ctx, "2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z", wealth.AccountFilter{OwnerIDs: []int64{owner.ID.Int64(), 999}})
	must.NoErr(t, err)
	if len(classifierByOwner) != 2 {
		t.Fatalf("ClassifierSnapshotValues(owner) = %d rows, want 2", len(classifierByOwner))
	}

	values, err := store.AccountBalanceSnapshotValues(ctx, "2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z", wealth.AccountFilter{})
	must.NoErr(t, err)
	liabilityValues := lo.Filter(values, func(value wealth.SnapshotValue, _ int) bool {
		return wealth.IsLiabilityType(model.AccountType(value.AccountType))
	})
	if len(liabilityValues) != 3 {
		t.Fatalf("liability snapshot values = %d rows, want 3", len(liabilityValues))
	}
	if liabilityValues[0].AccountType != string(model.AccountTypeCredit) || liabilityValues[0].BalanceUSD != -125 {
		t.Fatalf("first liability row = %#v, want credit -125", liabilityValues[0])
	}
	if liabilityValues[1].AccountType != string(model.AccountTypeLoan) || liabilityValues[1].AccountSubtype == nil || *liabilityValues[1].AccountSubtype != mortgageSubtype {
		t.Fatalf("second liability row = %#v, want mortgage subtype", liabilityValues[1])
	}
	if !liabilityValues[2].AccountManual || liabilityValues[2].AccountType != string(model.AccountTypeCredit) {
		t.Fatalf("third liability row = %#v, want manual credit", liabilityValues[2])
	}
	valuesByOwner, err := store.AccountBalanceSnapshotValues(ctx, "2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z", wealth.AccountFilter{OwnerIDs: []int64{owner.ID.Int64(), 999}})
	must.NoErr(t, err)
	liabilityByOwner := lo.Filter(valuesByOwner, func(value wealth.SnapshotValue, _ int) bool {
		return wealth.IsLiabilityType(model.AccountType(value.AccountType))
	})
	if len(liabilityByOwner) != 3 {
		t.Fatalf("liability snapshot values by owner = %d rows, want 3", len(liabilityByOwner))
	}
}
