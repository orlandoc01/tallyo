package wealth_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	testutil "tallyo/internal/utils/test"
	. "tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

func testService(store ServiceStore) *Service {
	return &Service{Store: store, Log: testutil.Logger, PriceProvider: testutil.LastKnownPriceProvider{}, Timezone: func() string { return "UTC" }}
}

func mustHistoricalNetWorth(t *testing.T, ctx context.Context, svc *Service, input model.HistoricalNetWorthInput) *model.HistoricalNetWorthReport {
	t.Helper()
	report, err := svc.HistoricalNetWorth(ctx, input)
	must.NoErr(t, err)
	return report
}

func TestServiceNetWorthAndAccountFields(t *testing.T) {
	ctx := context.Background()
	store, _, _ := seededWealthTestStore(t, ctx)
	svc := testService(store)

	report, err := svc.NetWorth(ctx, model.NetWorthInput{})
	must.NoErr(t, err)
	if report.CurrentAssetsUsd != money.FromDollars(1000) || report.CurrentLiabilitiesUsd != money.FromDollars(200) || report.CurrentNetWorthUsd != money.FromDollars(800) {
		t.Fatalf("report totals = %#v", report)
	}
	if len(report.ClassifierBreakdown) != 1 {
		t.Fatalf("report shape = %#v", report)
	}
	if len(report.LiabilityBreakdown) != 1 || report.LiabilityBreakdown[0].Category != model.LiabilityCategoryCard {
		t.Fatalf("liability breakdown = %#v", report.LiabilityBreakdown)
	}

	historical := mustHistoricalNetWorth(t, ctx, svc, model.HistoricalNetWorthInput{Range: model.NetWorthRangeYtd})
	if len(historical.Series) == 0 {
		t.Fatalf("historical series empty")
	}
	if historical.Series[0].Date < "2026-06-01" {
		t.Fatalf("series starts before first snapshot: %s", historical.Series[0].Date)
	}
}

func TestHistoricalNetWorthPointLimit(t *testing.T) {
	ctx := context.Background()
	store := openWealthTestStore(t)
	owner := testutil.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "point-limit-owner"})
	account := &model.Account{Owner: owner, Name: "Checking", Type: model.AccountTypeDepository}
	testutil.MustUpsertAccount(t, store, "point-limit-account", account)
	accountID := account.ID.Int64()
	assetName := "US Dollar"
	usdAsset := mustUpsertAsset(t, store, AssetUpsert{AssetType: model.AssetTypeCurrency, Identifier: "USD:point-limit", Name: &assetName, Classifier: model.AssetClassifierCash})
	usdPrice := 1.0
	value := 100.0

	seedSnapshotDaysAgo := func(days int) {
		date := time.Now().AddDate(0, 0, -days).Format("2006-01-02")
		must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, AccountBalanceSnapshot{
			AccountID: accountID, Source: "plaid", Date: date, SyncedAt: date + "T21:00:00Z",
			BalanceUSD: money.FromDollars(value),
			Holdings:   []AssetDailyHolding{{AssetID: usdAsset.ID.Int64(), Quantity: &value, Price: &usdPrice, ValueUSD: value, CountsTowardValue: true}},
		}))
	}

	seedSnapshotDaysAgo(100)
	svc := testService(store)
	accepted, err := svc.HistoricalNetWorth(ctx, model.HistoricalNetWorthInput{Range: model.NetWorthRangeAll})
	must.NoErr(t, err)
	if len(accepted.Series) == 0 || len(accepted.Series) > MaxHistoricalNetWorthPoints {
		t.Fatalf("accepted series length = %d, want (0, %d]", len(accepted.Series), MaxHistoricalNetWorthPoints)
	}

	seedSnapshotDaysAgo(MaxHistoricalNetWorthPoints + 50)
	if _, err := svc.HistoricalNetWorth(ctx, model.HistoricalNetWorthInput{Range: model.NetWorthRangeAll}); err == nil || !strings.Contains(err.Error(), "choose a coarser granularity") {
		t.Fatalf("expected over-limit error, got %v", err)
	}
}

func TestServiceNetWorthFiltersByAccountIDs(t *testing.T) {
	ctx := context.Background()
	store, accountID, cardID := seededWealthTestStore(t, ctx)
	svc := testService(store)
	accountGlobalID := model.New(model.GlobalIDAccount, accountID)
	cardGlobalID := model.New(model.GlobalIDAccount, cardID)

	report, err := svc.NetWorth(ctx, model.NetWorthInput{AccountIds: []*model.GlobalID{&accountGlobalID}})
	must.NoErr(t, err)
	if report.CurrentAssetsUsd != money.FromDollars(1000) || report.CurrentLiabilitiesUsd != 0 || report.CurrentNetWorthUsd != money.FromDollars(1000) {
		t.Fatalf("account-filtered report totals = %#v", report)
	}

	report, err = svc.NetWorth(ctx, model.NetWorthInput{AccountIds: []*model.GlobalID{&cardGlobalID}})
	must.NoErr(t, err)
	if report.CurrentAssetsUsd != 0 || report.CurrentLiabilitiesUsd != money.FromDollars(200) || report.CurrentNetWorthUsd != money.FromDollars(-200) {
		t.Fatalf("card-filtered report totals = %#v", report)
	}

	historical := mustHistoricalNetWorth(t, ctx, svc, model.HistoricalNetWorthInput{Range: model.NetWorthRangeAll, Filters: &model.NetWorthInput{AccountIds: []*model.GlobalID{&accountGlobalID}}})
	if len(historical.Series) == 0 || historical.Series[0].TotalAssetsUsd != money.FromDollars(1000) || historical.Series[0].TotalLiabilitiesUsd != 0 {
		t.Fatalf("account-filtered historical series = %#v", historical.Series)
	}
}

func TestNetWorthRanges(t *testing.T) {
	ctx := context.Background()
	store, _, _ := seededWealthTestStore(t, ctx)
	svc := testService(store)

	for _, r := range []model.NetWorthRange{
		model.NetWorthRangeThreeMonth,
		model.NetWorthRangeOneYear,
		model.NetWorthRangeAll,
	} {
		historical := mustHistoricalNetWorth(t, ctx, svc, model.HistoricalNetWorthInput{Range: r})
		if len(historical.Series) == 0 {
			t.Errorf("HistoricalNetWorth(%v): empty series", r)
		}
	}
}

func TestNetWorthGranularity(t *testing.T) {
	ctx := context.Background()
	store, _, _ := seededWealthTestStore(t, ctx)
	svc := testService(store)

	weekly := model.GranularityWeekly
	monthly := model.GranularityMonthly
	for _, g := range []*model.Granularity{&weekly, &monthly} {
		historical := mustHistoricalNetWorth(t, ctx, svc, model.HistoricalNetWorthInput{Range: model.NetWorthRangeOneYear, Granularity: g})
		if len(historical.Series) == 0 {
			t.Errorf("HistoricalNetWorth(granularity=%v): empty series", *g)
		}
	}
}

func TestNetWorthIncludesCryptoSnapshots(t *testing.T) {
	ctx := context.Background()
	store, _, _ := seededWealthTestStore(t, ctx)
	owner, err := store.OwnerByName(ctx, "alex")
	must.NoErr(t, err)
	_, account, err := store.CreateEVMWallet(ctx, "0x2222222222222222222222222222222222222222", owner.ID.Int64(), "wallet", []string{"eth"})
	must.NoErr(t, err)
	name := "Ethereum"
	price := 250.0
	asset := mustUpsertAsset(t, store, AssetUpsert{AssetType: model.AssetTypeCrypto, Identifier: "eth:eth", Name: &name, Classifier: model.AssetClassifierCryptocurrency, LastPrice: &price})
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, AccountBalanceSnapshot{
		AccountID:     account.ID.Int64(),
		WalletAddress: "0x2222",
		Source:        "debank",
		Date:          "2026-06-01",
		SyncedAt:      "2026-06-01T12:00:00Z",
		BalanceUSD:    money.FromDollars(250),
		Holdings: []AssetDailyHolding{{
			AssetID:           asset.ID.Int64(),
			ValueUSD:          250,
			CountsTowardValue: true,
		}},
	}))
	svc := testService(store)
	report, err := svc.NetWorth(ctx, model.NetWorthInput{})
	must.NoErr(t, err)
	if report.CurrentAssetsUsd != money.FromDollars(1250) {
		t.Fatalf("CurrentAssetsUsd = %v, want 1250", report.CurrentAssetsUsd)
	}
	for _, breakdown := range report.ClassifierBreakdown {
		if breakdown.Classifier == model.AssetClassifierCryptocurrency &&
			(len(breakdown.Holdings) != 1 || breakdown.Holdings[0].TotalQuantity != nil) {
			t.Fatalf("crypto holdings = %#v, want unknown quantity", breakdown.Holdings)
		}
	}
	historical := mustHistoricalNetWorth(t, ctx, svc, model.HistoricalNetWorthInput{Range: model.NetWorthRangeAll})
	if historical.Series[0].TotalAssetsUsd != money.FromDollars(1250) {
		t.Fatalf("first series assets = %v, want 1250", historical.Series[0].TotalAssetsUsd)
	}
}

func TestNetWorthReadsSecuritySnapshotsWithoutPriceProvider(t *testing.T) {
	ctx := context.Background()
	store := openWealthTestStore(t)
	owner := testutil.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "alex"})
	account := &model.Account{Owner: owner, Name: "Brokerage", Type: model.AccountTypeInvestment}
	testutil.MustUpsertAccount(t, store, "invest", account)
	name := "Apple Inc"
	lastPrice := 10.0
	asset := mustUpsertAsset(t, store, AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "AAPL", Name: &name, Classifier: model.AssetClassifierPublic, LastPrice: &lastPrice})
	historicalTime := time.Now().UTC().AddDate(0, 0, -2)
	historicalDate := historicalTime.Format("2006-01-02")
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, AccountBalanceSnapshot{
		AccountID:  account.ID.Int64(),
		Source:     "plaid",
		Date:       historicalDate,
		SyncedAt:   historicalTime.Format(time.RFC3339),
		BalanceUSD: money.FromDollars(40),
		Holdings: []AssetDailyHolding{{
			AssetID:           asset.ID.Int64(),
			Quantity:          new(float64(2)),
			Price:             new(float64(20)),
			ValueUSD:          40,
			CountsTowardValue: true,
		}},
	}))
	today := time.Now().UTC().Format("2006-01-02")
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, AccountBalanceSnapshot{
		AccountID:  account.ID.Int64(),
		Source:     "plaid",
		Date:       today,
		SyncedAt:   time.Now().UTC().Format(time.RFC3339),
		BalanceUSD: money.FromDollars(60),
		Holdings: []AssetDailyHolding{{
			AssetID:           asset.ID.Int64(),
			Quantity:          new(float64(2)),
			Price:             new(float64(30)),
			ValueUSD:          60,
			CountsTowardValue: true,
		}},
	}))
	svc := testService(store)

	report, err := svc.NetWorth(ctx, model.NetWorthInput{})
	must.NoErr(t, err)
	if report.CurrentAssetsUsd != money.FromDollars(60) {
		t.Fatalf("CurrentAssetsUsd = %v, want 60", report.CurrentAssetsUsd)
	}
	if got := report.ClassifierBreakdown[0].ValueUsd; got != money.FromDollars(60) {
		t.Fatalf("current breakdown value = %v, want 60", got)
	}
	historical := mustHistoricalNetWorth(t, ctx, svc, model.HistoricalNetWorthInput{Range: model.NetWorthRangeAll})
	if historical.Series[0].TotalAssetsUsd != money.FromDollars(40) {
		t.Fatalf("first historical assets = %v, want 40", historical.Series[0].TotalAssetsUsd)
	}
	if got := historical.Series[len(historical.Series)-1].TotalAssetsUsd; got != money.FromDollars(60) {
		t.Fatalf("final series assets = %v, want 60", got)
	}
}

func TestNetWorthUsesProviderSnapshotsByDate(t *testing.T) {
	ctx := context.Background()
	store := openWealthTestStore(t)
	owner := testutil.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "alex"})
	account := &model.Account{Owner: owner, Name: "Brokerage", Type: model.AccountTypeInvestment}
	testutil.MustUpsertAccount(t, store, "invest", account)
	name := "Apple Inc"
	asset := mustUpsertAsset(t, store, AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "AAPL", Name: &name, Classifier: model.AssetClassifierPublic})
	backfillDate := time.Now().UTC().AddDate(0, 0, -2).Format("2006-01-02")
	plaidDate := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	for _, snapshot := range []AccountBalanceSnapshot{
		securitySnapshot(account.ID.Int64(), asset.ID.Int64(), "plaid", backfillDate, 100),
		securitySnapshot(account.ID.Int64(), asset.ID.Int64(), "plaid", plaidDate, 110),
	} {
		must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, snapshot))
	}
	svc := testService(store)

	historical := mustHistoricalNetWorth(t, ctx, svc, model.HistoricalNetWorthInput{Range: model.NetWorthRangeAll})
	if got := seriesAssetsForDate(t, historical.Series, backfillDate); got != money.FromDollars(100) {
		t.Fatalf("older provider date assets = %v, want 100", got)
	}
	if got := seriesAssetsForDate(t, historical.Series, plaidDate); got != money.FromDollars(110) {
		t.Fatalf("plaid date assets = %v, want 110", got)
	}
}

func TestNetWorthCurrentSnapshotsIncludeManualAccounts(t *testing.T) {
	ctx := context.Background()
	store := openWealthTestStore(t)
	owner := testutil.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "alex"})
	providerAccount := &model.Account{Owner: owner, Name: "Brokerage", Type: model.AccountTypeInvestment}
	manualAssetAccount := &model.Account{Owner: owner, Name: "Manual Asset", Type: model.AccountTypeOther, Manual: true}
	manualLiabilityAccount := &model.Account{Owner: owner, Name: "Manual Liability", Type: model.AccountTypeCredit, Manual: true}
	accountsByExternalID := map[string]*model.Account{
		"invest":                   providerAccount,
		"manual_asset_account":     manualAssetAccount,
		"manual_liability_account": manualLiabilityAccount,
	}
	for externalID, account := range accountsByExternalID {
		testutil.MustUpsertAccount(t, store, externalID, account)
	}
	name := "Apple Inc"
	asset := mustUpsertAsset(t, store, AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "AAPL", Name: &name, Classifier: model.AssetClassifierPublic})
	for _, snapshot := range []AccountBalanceSnapshot{
		securitySnapshot(providerAccount.ID.Int64(), asset.ID.Int64(), "plaid", "2026-06-01", 1000),
		securitySnapshot(providerAccount.ID.Int64(), asset.ID.Int64(), "plaid", "2026-06-02", 100),
		securitySnapshot(manualAssetAccount.ID.Int64(), asset.ID.Int64(), syncerids.Manual.Str(), "2026-06-02", 40),
		{AccountID: manualLiabilityAccount.ID.Int64(), Source: syncerids.Manual.Str(), Date: "2026-06-02", SyncedAt: "2026-06-02T22:00:00Z", BalanceUSD: money.FromDollars(15)},
	} {
		must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, snapshot))
	}
	svc := testService(store)

	report, err := svc.NetWorth(ctx, model.NetWorthInput{})
	must.NoErr(t, err)
	if report.CurrentAssetsUsd != money.FromDollars(140) || report.CurrentLiabilitiesUsd != money.FromDollars(15) || report.CurrentNetWorthUsd != money.FromDollars(125) {
		t.Fatalf("report totals = %#v, want assets 140 liabilities 15 net 125", report)
	}
}

func TestHistoricalNetWorthClosedAccountStopsAfterLastSnapshot(t *testing.T) {
	ctx := context.Background()
	store := openWealthTestStore(t)
	owner := testutil.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "alex"})
	account := &model.Account{Owner: owner, Name: "Brokerage", Type: model.AccountTypeInvestment}
	testutil.MustUpsertAccount(t, store, "closed-history", account)
	assetName := "Apple Inc"
	asset := mustUpsertAsset(t, store, AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "AAPL", Name: &assetName, Classifier: model.AssetClassifierPublic})
	for _, snapshot := range []AccountBalanceSnapshot{
		securitySnapshot(account.ID.Int64(), asset.ID.Int64(), "plaid", "2026-01-01", 100),
		securitySnapshot(account.ID.Int64(), asset.ID.Int64(), "plaid", "2026-01-03", 120),
	} {
		must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, snapshot))
	}
	closed := true
	if _, err := store.UpdateAccount(ctx, account.ID.Int64(), model.UpdateAccountInput{Closed: &closed}); err != nil {
		t.Fatalf("UpdateAccount(closed): %v", err)
	}
	svc := testService(store)

	historical, err := svc.HistoricalNetWorth(ctx, model.HistoricalNetWorthInput{Range: model.NetWorthRangeAll})
	must.NoErr(t, err)
	if got := seriesAssetsForDate(t, historical.Series, "2026-01-01"); got != money.FromDollars(100) {
		t.Fatalf("2026-01-01 assets = %v, want 100", got)
	}
	if got := seriesAssetsForDate(t, historical.Series, "2026-01-02"); got != money.FromDollars(100) {
		t.Fatalf("2026-01-02 assets = %v, want 100", got)
	}
	if got := seriesAssetsForDate(t, historical.Series, "2026-01-03"); got != money.FromDollars(120) {
		t.Fatalf("2026-01-03 assets = %v, want 120", got)
	}
	if got := seriesAssetsForDate(t, historical.Series, "2026-01-04"); got != 0 {
		t.Fatalf("2026-01-04 assets = %v, want 0", got)
	}
}

func TestQuote(t *testing.T) {
	svc := &Service{Log: testutil.Logger, PriceProvider: assetStubProvider{price: 150.0}}
	q, err := svc.Quote(context.Background(), "aapl")
	must.NoErr(t, err)
	if q.Ticker != "AAPL" || q.PriceUsd != 150.0 {
		t.Errorf("Quote() = %+v", q)
	}
}

func TestNetWorthWithManualDebtSnapshot(t *testing.T) {
	ctx := context.Background()
	store := openWealthTestStore(t)

	owner := testutil.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "alex"})
	acct, _ := store.CreateManualAccount(ctx, model.CreateManualAccountInput{
		Name: "Manual", OwnerID: owner.ID, Type: model.AccountTypeCredit,
	})
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, AccountBalanceSnapshot{
		AccountID:  acct.ID.Int64(),
		Source:     syncerids.Manual.Str(),
		Date:       time.Now().UTC().Format(time.DateOnly),
		SyncedAt:   time.Now().UTC().Format(time.RFC3339),
		BalanceUSD: money.FromDollars(5000.0),
		Holdings:   []AssetDailyHolding{},
	}))

	svc := testService(store)
	report, err := svc.NetWorth(ctx, model.NetWorthInput{})
	must.NoErr(t, err)
	if report.CurrentLiabilitiesUsd != money.FromDollars(5000.0) {
		t.Errorf("CurrentLiabilitiesUsd = %d, want 500000 cents", report.CurrentLiabilitiesUsd)
	}
}

func securitySnapshot(accountID int64, assetID int64, source, date string, value float64) AccountBalanceSnapshot {
	quantity := 1.0
	return AccountBalanceSnapshot{
		AccountID:  accountID,
		Source:     source,
		Date:       date,
		SyncedAt:   date + "T21:00:00Z",
		BalanceUSD: money.FromDollars(value),
		Holdings: []AssetDailyHolding{{
			AssetID:           assetID,
			Quantity:          &quantity,
			Price:             &value,
			ValueUSD:          value,
			CountsTowardValue: true,
		}},
	}
}

func seriesAssetsForDate(t *testing.T, series []*model.NetWorthPoint, date string) money.Cents {
	t.Helper()
	for _, point := range series {
		if string(point.Date) == date {
			return point.TotalAssetsUsd
		}
	}
	t.Fatalf("series missing date %s: %#v", date, series)
	return 0
}

func seededWealthTestStore(t *testing.T, ctx context.Context) (*wealthTestStore, int64, int64) {
	t.Helper()
	store := openWealthTestStore(t)
	owner := testutil.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "alex"})
	accounts := []*model.Account{
		{Owner: owner, Name: "Checking", Type: model.AccountTypeDepository},
		{Owner: owner, Name: "Card", Type: model.AccountTypeCredit},
	}
	externalIDs := []string{"cash", "card"}
	for i, account := range accounts {
		testutil.MustUpsertAccount(t, store, externalIDs[i], account)
	}
	cashID := accounts[0].ID.Int64()
	cardID := accounts[1].ID.Int64()
	usdPrice := 1.0
	assetName := "US Dollar"
	usdAsset := mustUpsertAsset(t, store, AssetUpsert{
		AssetType:  model.AssetTypeCurrency,
		Identifier: "USD",
		Name:       &assetName,
		Classifier: model.AssetClassifierCash,
	})
	cardAssetName := "Stablecoin Holdings"
	cardAsset := mustUpsertAsset(t, store, AssetUpsert{
		AssetType:  model.AssetTypeCrypto,
		Identifier: "USDC",
		Name:       &cardAssetName,
		Classifier: model.AssetClassifierStablecoin,
	})
	for _, s := range []struct {
		id    int64
		asset int64
		value float64
	}{
		{cashID, usdAsset.ID.Int64(), 1000},
		{cardID, cardAsset.ID.Int64(), 200},
	} {
		must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, AccountBalanceSnapshot{
			AccountID:  s.id,
			Source:     "plaid",
			Date:       "2026-06-01",
			SyncedAt:   "2026-06-01T21:00:00Z",
			BalanceUSD: money.FromDollars(s.value),
			Holdings: []AssetDailyHolding{{
				AssetID:           s.asset,
				Quantity:          &s.value,
				Price:             &usdPrice,
				ValueUSD:          s.value,
				CountsTowardValue: true,
			}},
		}))
	}
	must.NoErr(t, store.MarkAccountBalanceSynced(ctx, cashID, time.Now().UTC()))
	return store, cashID, cardID
}
