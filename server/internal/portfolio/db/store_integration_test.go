package portfoliodb_test

import (
	"context"
	"testing"
	"time"

	accountsdb "tallyo/internal/accounts/db"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/portfolio"
	portfoliodb "tallyo/internal/portfolio/db"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	wealthdb "tallyo/internal/wealth/db"
)

func TestStoreReportsAndCurrentPublicHoldings(t *testing.T) {
	ctx := context.Background()
	base := test.OpenStore(t)
	accountsStore := accountsdb.New(base.Database())
	adminStore := admindb.New(base.Database())
	wealthStore := wealthdb.New(base.Database())
	store := portfoliodb.New(base.Database())

	owner, itemID := test.SeedPlaidItem(t, accountsStore, adminStore, "item", "alex")
	connectionName := "Institution"
	conn := test.MustCreateConnection(t, accountsStore, itemID, &connectionName, owner.ID.Int64())
	subtype := "401k"
	account := &model.Account{Connection: conn, Owner: owner, Name: "401k", Type: model.AccountTypeInvestment, Subtype: &subtype}
	test.MustUpsertAccount(t, accountsStore, "invest", account)
	accountID := account.ID.Int64()
	assetName := "Vanguard Total Stock Market ETF"
	asset, err := wealthStore.UpsertAsset(ctx, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "VTI", Name: &assetName, Classifier: model.AssetClassifierPublic})
	must.NoErr(t, err)
	missingReportName := "Missing Report Fund"
	missingReportAsset, err := wealthStore.UpsertAsset(ctx, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "MISSING", Name: &missingReportName, Classifier: model.AssetClassifierPublic})
	must.NoErr(t, err)
	zeroWeightName := "Zero Weight Fund"
	zeroWeightAsset, err := wealthStore.UpsertAsset(ctx, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "ZERO", Name: &zeroWeightName, Classifier: model.AssetClassifierPublic})
	must.NoErr(t, err)
	quantity, price := 2.0, 50.0
	must.NoErr(t, wealthStore.ReplaceAccountBalanceSnapshot(ctx, wealth.AccountBalanceSnapshot{AccountID: accountID, Source: "plaid", Date: "2026-06-01", SyncedAt: "2026-06-01T12:00:00Z", BalanceUSD: 175, Holdings: []wealth.AssetDailyHolding{
		{AssetID: asset.ID.Int64(), Quantity: &quantity, Price: &price, ValueUSD: 100, CountsTowardValue: true},
		{AssetID: missingReportAsset.ID.Int64(), Quantity: &quantity, Price: &price, ValueUSD: 50, CountsTowardValue: true},
		{AssetID: zeroWeightAsset.ID.Int64(), Quantity: &quantity, Price: &price, ValueUSD: 25, CountsTowardValue: true},
	}}))
	assetID := asset.ID.Int64()
	zeroWeightAssetID := zeroWeightAsset.ID.Int64()
	fetchedAt := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	vtiReport := portfolio.AssetReport{AssetID: assetID, Category: "Large Blend", Group: "US Equity", StockPosition: 1, SectorTechnology: 0.25, FetchedAt: fetchedAt}
	must.NoErr(t, store.UpsertReport(ctx, vtiReport))
	must.NoErr(t, store.UpsertReport(ctx, portfolio.AssetReport{AssetID: zeroWeightAssetID, Category: "Stable Value", Group: "Other", FetchedAt: fetchedAt}))
	needing, err := store.PublicAssetsNeedingReport(ctx, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	if err != nil || len(needing) != 3 || needing[0].Identifier != "MISSING" || needing[1].Identifier != "VTI" {
		t.Fatalf("PublicAssetsNeedingReport() = %#v, %v", needing, err)
	}
	vtiReport.FetchedAt = time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	must.NoErr(t, store.UpsertReport(ctx, vtiReport))
	must.NoErr(t, store.UpdateAssetInvestmentConnectivity(ctx, missingReportAsset.ID.Int64(), model.ConnectivityStatusNotFound))
	must.NoErr(t, store.UpdateAssetInvestmentConnectivity(ctx, zeroWeightAssetID, model.ConnectivityStatusIgnore))
	if needing, err = store.PublicAssetsNeedingReport(ctx, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)); err != nil || len(needing) != 0 {
		t.Fatalf("PublicAssetsNeedingReport(fresh/ignored) = %#v, %v", needing, err)
	}

	reports, err := store.ReportsByAssetIDs(ctx, []int64{assetID})
	if err != nil || reports[assetID].SectorTechnology != 0.25 {
		t.Fatalf("ReportsByAssetIDs() = %#v, %v", reports, err)
	}

	holdings, err := store.CurrentPublicHoldings(ctx, portfolio.HoldingsFilter{OwnerIDs: []int64{owner.ID.Int64()}, AccountSubtypes: []string{subtype}, AccountIDs: []int64{accountID}})
	must.NoErr(t, err)
	if len(holdings) != 2 || holdings[0].AssetID != assetID || holdings[0].ValueUSD != money.FromDollars(100) || holdings[1].AssetID != zeroWeightAssetID {
		t.Fatalf("holdings = %#v", holdings)
	}
	unclassified, err := store.CurrentPublicHoldings(ctx, portfolio.HoldingsFilter{AccountIDs: []int64{accountID}, IncludeUnclassified: true})
	must.NoErr(t, err)
	if len(unclassified) != 3 {
		t.Fatalf("include unclassified holdings = %#v", unclassified)
	}
	missing, err := store.CurrentPublicHoldings(ctx, portfolio.HoldingsFilter{OwnerIDs: []int64{999}})
	if err != nil || len(missing) != 0 {
		t.Fatalf("filtered holdings = %#v, %v", missing, err)
	}
}
