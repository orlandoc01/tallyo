package plaid

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	admindb "tallyo/internal/admin/db"
	clientspkg "tallyo/internal/clients"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	testutil "tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	wealthdb "tallyo/internal/wealth/db"
	"tallyo/internal/wealth/syncerids"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"tallyo/internal/utils/must"
)

func TestSyncDueUsesPlaidStoresAndClientFactory(t *testing.T) {
	ctx := context.Background()
	store := &plaidStore{
		items: []accounts.PlaidItemSecret{{ID: 1, AccessToken: "token", CredentialID: 7}},
		reads: readStore{asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)}},
	}
	factory := &clientFactory{client: plaidBalanceClient([]plaidapi.AccountBase{depositoryAccountWithBalance()}, nil)}
	adapter := newTestAdapter(store, store, factory, nil, testutil.Logger)

	sink := testEventSink()
	must.NoErr(t, adapter.SyncDue(ctx, sink))
	if factory.calls != 1 || store.dueCalls != 1 {
		t.Fatalf("factory=%d due=%d", factory.calls, store.dueCalls)
	}
	if len(sink.Events) != 1 || sink.Events[0].Snapshot == nil || sink.Events[0].Snapshot.AccountID != 1 {
		t.Fatalf("events = %#v", sink.Events)
	}
	if store.syncedCalls != 1 {
		t.Fatalf("synced calls = %d, want one synced item", store.syncedCalls)
	}
}

func TestSyncDueContinuesAfterItemError(t *testing.T) {
	ctx := context.Background()
	store := &plaidStore{
		items: []accounts.PlaidItemSecret{
			{ID: 1, AccessToken: "bad", CredentialID: 7},
			{ID: 2, AccessToken: "good", CredentialID: 7},
		},
		reads: readStore{asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)}},
	}
	factory := &clientFactory{client: plaidBalanceClient(
		[]plaidapi.AccountBase{depositoryAccountWithBalance()},
		map[string]error{"bad": errors.New("bad item")},
	)}
	adapter := newTestAdapter(store, store, factory, nil, testutil.Logger)
	sink := testEventSink()

	must.NoErr(t, adapter.SyncDue(ctx, sink))
	if factory.calls != 2 || store.syncedCalls != 1 || len(sink.Events) != 1 {
		t.Fatalf("factory=%d synced=%d events=%d", factory.calls, store.syncedCalls, len(sink.Events))
	}
}

func TestSyncDueUsesGlobalBalanceScheduleCron(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t)
	db := store.Database()
	accountsStore := accountsdb.New(db)
	adminStore := admindb.New(db)
	accountModel := testutil.SeedPlaidAccount(t, accountsStore, adminStore, "acc", "schedule-owner")
	if _, err := store.SQL().ExecContext(
		ctx,
		`UPDATE balance_sync_schedules SET balance_sync_cron = '0 9 * * *' WHERE id = 'plaid'`,
	); err != nil {
		t.Fatalf("update plaid balance schedule: %v", err)
	}

	adapter := New(
		db,
		&clientFactory{client: plaidBalanceClient([]plaidapi.AccountBase{depositoryAccountWithBalance()}, nil)},
		nil,
		testutil.Logger,
	)
	sink := testEventSink()

	must.NoErr(t, adapter.SyncDue(ctx, sink))
	secret, err := wealthdb.New(db).PlaidItemSecretByID(ctx, accountModel.Connection.SourceID)
	must.NoErr(t, err)
	expected := time.Date(2026, 6, 1, 13, 0, 0, 0, time.UTC)
	if secret == nil || secret.NextBalanceSyncAt == nil || !secret.NextBalanceSyncAt.Equal(expected) {
		t.Fatalf("NextBalanceSyncAt = %#v, want %v", secret, expected)
	}
}

func TestSyncItemIntoConfirmationAndMissingAccountFallback(t *testing.T) {
	ctx := context.Background()
	store := &plaidStore{reads: readStore{asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)}}}
	adapter := newTestAdapter(
		store,
		store,
		&clientFactory{client: plaidBalanceClient([]plaidapi.AccountBase{depositoryAccountWithBalance()}, nil)},
		nil,
		testutil.Logger,
	)
	sink := testEventSink()
	sink.Err = errors.New("persist failed")
	err := adapter.SyncItemInto(ctx, accounts.PlaidItemSecret{ID: 1, AccessToken: "token"}, "0 0 * * *", sink)
	if err == nil || store.syncedCalls != 0 {
		t.Fatalf("err=%v syncedCalls=%d, want persist error and no confirmation", err, store.syncedCalls)
	}

	store = &plaidStore{reads: readStore{asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)}}}
	adapter = newTestAdapter(store, store, &clientFactory{client: testutil.PlaidClientStub{}}, nil, testutil.Logger)
	sink = testEventSink()
	must.NoErr(t, adapter.SyncItemInto(ctx, accounts.PlaidItemSecret{ID: 2, AccessToken: "token"}, "0 0 * * *", sink))
	if store.syncedCalls != 1 {
		t.Fatalf("syncedCalls = %d, want confirmation after empty successful session", store.syncedCalls)
	}
	store.reads.accountErr = sql.ErrNoRows
	resolved, err := adapter.resolveAccounts(ctx, []plaidapi.AccountBase{depositoryAccountWithBalance()})
	if err != nil || resolved["acc"].Type != model.AccountTypeDepository {
		t.Fatalf("resolved=%#v err=%v", resolved, err)
	}
}

func TestSyncItemIntoStopsOnAccountTypeLookupError(t *testing.T) {
	ctx := context.Background()
	dbErr := errors.New("database unavailable")
	store := &plaidStore{reads: readStore{accountErr: dbErr}}
	adapter := newTestAdapter(
		store,
		store,
		&clientFactory{client: plaidBalanceClient([]plaidapi.AccountBase{depositoryAccountWithBalance()}, nil)},
		nil,
		testutil.Logger,
	)
	sink := testEventSink()

	err := adapter.SyncItemInto(ctx, accounts.PlaidItemSecret{ID: 1, AccessToken: "token"}, "0 0 * * *", sink)
	if !errors.Is(err, dbErr) || !strings.Contains(err.Error(), "lookup account type acc") || store.syncedCalls != 0 || len(sink.Events) != 0 {
		t.Fatalf("err=%v syncedCalls=%d events=%d", err, store.syncedCalls, len(sink.Events))
	}
}

func TestSyncConnectionIntoLoadsPlaidItem(t *testing.T) {
	ctx := context.Background()
	store := &plaidStore{
		items: []accounts.PlaidItemSecret{{ID: 1, AccessToken: "token", CredentialID: 7}},
		reads: readStore{asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)}},
	}
	adapter := newTestAdapter(
		store,
		store,
		&clientFactory{client: plaidBalanceClient([]plaidapi.AccountBase{depositoryAccountWithBalance()}, nil)},
		nil,
		testutil.Logger,
	)
	sink := testEventSink()
	sink.NowValue = time.Date(2026, 6, 1, 23, 30, 0, 0, time.UTC)

	must.NoErr(t, adapter.SyncConnectionInto(ctx, wealth.ConnectionRef{SourceID: 1}, sink))
	handlesPlaid, err := adapter.Handles(ctx, wealth.ConnectionRef{SourceTable: accounts.SourceTablePlaidItem})
	must.NoErr(t, err)
	handlesEVM, err := adapter.Handles(ctx, wealth.ConnectionRef{SourceTable: accounts.SourceTableEVMWallet})
	must.NoErr(t, err)
	if !handlesPlaid || handlesEVM {
		t.Fatalf("provider routing mismatch")
	}
	if store.syncedCalls != 1 || len(sink.Events) != 1 {
		t.Fatalf("syncedCalls=%d events=%d", store.syncedCalls, len(sink.Events))
	}
}

func TestInvestmentHoldingPriceAndSecurityHelpers(t *testing.T) {
	ctx := context.Background()
	provider := &recordingPriceProvider{price: 0}
	adapter := newTestAdapter(nil, &readStore{}, nil, provider, testutil.Logger)
	historical := 7.0
	forced := 12.0
	asset := &model.Asset{ID: model.New(model.GlobalIDAsset, 1), AssetType: model.AssetTypeSecurity, Identifier: "SPAXX", CurrentPrice: &historical, ForcedUsdPrice: &forced}
	security := plaidapi.NewSecurityWithDefaults()
	security.SetClosePrice(10)
	holding := plaidapi.NewHoldingWithDefaults()
	holding.SetInstitutionPrice(15)

	price, institution, err := adapter.investmentHoldingPrice(ctx, asset, *holding, *security, "2026-06-01")
	if err != nil || price == nil || *price != forced || institution || provider.calls != 0 {
		t.Fatalf("forced price = %v institution=%v err=%v calls=%d", price, institution, err, provider.calls)
	}
	asset.ForcedUsdPrice = nil
	price, institution, err = adapter.investmentHoldingPrice(ctx, asset, *holding, *security, "2026-06-01")
	if err != nil || price == nil || *price != 15 || !institution {
		t.Fatalf("institution price = %v institution=%v err=%v", price, institution, err)
	}
	holding.SetInstitutionPrice(0)
	price, _, err = adapter.investmentHoldingPrice(ctx, asset, *holding, *security, "2026-06-01")
	if err != nil || price == nil || *price != 10 {
		t.Fatalf("plaid fallback = %v err=%v", price, err)
	}
	security = plaidapi.NewSecurityWithDefaults()
	price, _, err = adapter.investmentHoldingPrice(ctx, asset, *holding, *security, "2026-06-01")
	if err != nil || price == nil || *price != historical {
		t.Fatalf("historical fallback = %v err=%v", price, err)
	}
	provider.err = errors.New("price failed")
	if price, _, err := adapter.investmentHoldingPrice(ctx, asset, *holding, *security, "bad-date"); err == nil || price != nil {
		t.Fatalf("bad date price = %v err=%v", price, err)
	}

	if got := securityToClassifier("cash", false); got != model.AssetClassifierCash {
		t.Fatalf("securityToClassifier(cash) = %v", got)
	}
	if got := securityToClassifier("equity", true); got != model.AssetClassifierCash {
		t.Fatalf("securityToClassifier(cash equivalent) = %v", got)
	}
	if got := securityToClassifier("bond", false); got != model.AssetClassifierPublic {
		t.Fatalf("securityToClassifier(bond) = %v", got)
	}
	security.SetClosePrice(42)
	if price, priceAt := securityPrice(*security); price == nil || *price != 42 || priceAt == nil {
		t.Fatalf("securityPrice(close) = %v %v", price, priceAt)
	}
}

func TestInvestmentDraftAndReconcileBalancesEmitSnapshots(t *testing.T) {
	draft := wealth.NewInvestmentSnapshotDraft()
	price := 5.0
	asset := &wealth.AssetUpsert{Identifier: "asset"}
	addInvestmentHolding(draft, asset, 2, &price)
	addInvestmentHolding(draft, asset, 3, &price)
	addInvestmentHolding(draft, &wealth.AssetUpsert{Identifier: "nil-price"}, 4, nil)
	if len(draft.Holdings) != 2 || draft.Holdings[0].Quantity == nil || *draft.Holdings[0].Quantity != 5 || draft.Total != 25 {
		t.Fatalf("merged draft = %#v total=%v", draft.Holdings, draft.Total)
	}
	if firstPrice(nil, new(float64)) != nil {
		t.Fatal("firstPrice(nil, zero) returned value")
	}
	snapshots := map[string]*wealth.InvestmentSnapshotDraft{}
	if snapshotDraftForAccount(snapshots, "acc") == nil || snapshots["acc"] == nil {
		t.Fatalf("snapshotDraftForAccount did not create draft: %#v", snapshots)
	}

	adapter := newTestAdapter(nil, &readStore{asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)}}, nil, nil, testutil.Logger)
	events := make(chan wealth.PersistEvent, 1)
	sink := testEventSink()
	account := accountWithBalance("acc", plaidapi.ACCOUNTTYPE_DEPOSITORY, 123)
	dbAccounts := map[string]resolvedAccount{"acc": {ID: 1, Type: model.AccountTypeDepository}}
	must.NoErr(t, adapter.reconcileBalances(context.Background(), []plaidapi.AccountBase{account}, dbAccounts, sink, events))
	snap := (<-events).Snapshot
	if snap == nil || snap.AccountID != 1 || snap.BalanceUSD != money.FromDollars(123) || len(snap.Holdings) != 1 {
		t.Fatalf("snapshot = %#v", snap)
	}
}

func TestReconcileHoldingsEmitsInvestmentAndEmptySnapshots(t *testing.T) {
	ctx := context.Background()
	adapter := newTestAdapter(nil, &readStore{asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)}}, nil, &recordingPriceProvider{price: 100}, testutil.Logger)
	events := make(chan wealth.PersistEvent, 3)
	sink := testEventSink()

	withoutHoldings := testutil.AccountBase("acc-empty", "", "", string(plaidapi.ACCOUNTTYPE_INVESTMENT), "")
	resp := investmentHoldingsResponse("vti", 210)
	resp.Accounts = append(resp.Accounts, withoutHoldings)
	resp.Securities[0].SetName("Vanguard Total Stock Market")
	resp.Securities[0].SetClosePrice(200)
	balances := []plaidapi.AccountBase{accountWithBalance("acc-empty", plaidapi.ACCOUNTTYPE_INVESTMENT, 0)}
	must.NoErr(t, adapter.reconcileHoldings(ctx, resp, balances, nil, sink, events))

	first := (<-events).Snapshot
	second := (<-events).Snapshot
	byAccount := map[int64]*wealth.SnapshotDraft{first.AccountID: first, second.AccountID: second}
	investment := byAccount[1]
	if investment.BalanceUSD != money.FromDollars(2100) || len(investment.Holdings) != 1 || investment.Holdings[0].Asset == nil {
		t.Fatalf("investment snapshot = %#v", investment)
	}
	if investment.Holdings[0].Asset.Identifier != "VTI" || investment.Holdings[0].PriceUpdate == nil {
		t.Fatalf("holding asset/update = %#v", investment.Holdings[0])
	}
	if investment.Holdings[0].Asset.AdapterSource == nil || investment.Holdings[0].Asset.AdapterSource.Adapter != syncerids.Plaid || investment.Holdings[0].Asset.AdapterSource.SourceID != "sec-1" {
		t.Fatalf("holding adapter source = %#v", investment.Holdings[0].Asset.AdapterSource)
	}
	empty := byAccount[2]
	if empty.BalanceUSD != 0 || empty.Decision != wealth.DecisionClean {
		t.Fatalf("empty snapshot = %#v", empty)
	}
}

// TestReconcileHoldingsUsesPersistedAssetForPricing covers the pricing-asset
// resolution added in front of Plaid valuation: once a security has a
// persisted asset row (found via adapter source, keyed on the immutable Plaid
// security ID rather than the identifier the user may have renamed), that row
// - not the transient provider-derived asset - drives forced price, Yahoo
// proxy pricing, and recalibration.
func TestReconcileHoldingsUsesPersistedAssetForPricing(t *testing.T) {
	t.Run("forced price outranks institution price", func(t *testing.T) {
		forcedPrice := 999.0
		persisted := &model.Asset{
			ID:             model.New(model.GlobalIDAsset, 42),
			Identifier:     "MY-VTI-RENAMED", // user-edited, differs from the provider ticker
			ForcedUsdPrice: &forcedPrice,
		}
		snap, _ := reconcilePersistedHolding(t, persisted, 100, 210)
		if len(snap.Holdings) != 1 || snap.Holdings[0].Price == nil || *snap.Holdings[0].Price != forcedPrice {
			t.Fatalf("holding price = %#v, want forced price %v", snap.Holdings[0], forcedPrice)
		}
		if snap.Holdings[0].PriceUpdate != nil {
			t.Fatalf("PriceUpdate = %#v, want none: a forced price never recalibrates", snap.Holdings[0].PriceUpdate)
		}
	})

	t.Run("custom ticker recalibrates keyed by adapter source, not identifier", func(t *testing.T) {
		persisted := &model.Asset{
			ID:                 model.New(model.GlobalIDAsset, 42),
			Identifier:         "MY-VTI-RENAMED",
			TrackingTicker:     new("PROXY"),
			TrackingMultiplier: 1,
		}
		snap, _ := reconcilePersistedHolding(t, persisted, 105, 210) // unmultiplied PROXY price used to derive the multiplier
		holding := snap.Holdings[0]
		// The provider-derived asset (used for discovery/upsert) still carries
		// the provider's own ticker as identifier, distinct from the persisted,
		// user-edited identifier - proving the match below is by adapter source.
		if holding.Asset == nil || holding.Asset.Identifier == persisted.Identifier {
			t.Fatalf("holding.Asset = %#v, want the provider-derived (unrenamed) asset", holding.Asset)
		}
		if holding.PriceUpdate == nil || holding.PriceUpdate.Price != 210 {
			t.Fatalf("PriceUpdate = %#v, want institution price 210 recalibration", holding.PriceUpdate)
		}
		if holding.PriceUpdate.TrackingMultiplier == nil || *holding.PriceUpdate.TrackingMultiplier != 2 {
			t.Fatalf("recalibrated multiplier = %v, want 2 (210/105)", holding.PriceUpdate.TrackingMultiplier)
		}
	})

	t.Run("custom ticker without institution price uses persisted asset for Yahoo proxy pricing", func(t *testing.T) {
		persisted := &model.Asset{
			ID:                 model.New(model.GlobalIDAsset, 42),
			Identifier:         "MY-VTI-RENAMED",
			TrackingTicker:     new("PROXY"),
			TrackingMultiplier: 3,
		}
		_, prices := reconcilePersistedHolding(t, persisted, 50, 0) // no institution price -> falls through to the price provider

		if len(prices.seen) == 0 || prices.seen[0] == nil || prices.seen[0].TrackingTicker == nil || *prices.seen[0].TrackingTicker != "PROXY" {
			t.Fatalf("price provider saw = %#v, want a call carrying the persisted custom tracking ticker", prices.seen)
		}
	})
}

func TestReconcileHoldingsFlagsPriceDeviationAndRaisesReview(t *testing.T) {
	store := &readStore{
		asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)},
		prior: priorSnapshotWithHolding("VTI", 2, 20),
	}
	adapter := newTestAdapter(nil, store, nil, &recordingPriceProvider{price: 210}, testutil.Logger)

	// Institution price 210 is 105x the prior 2 — past the 100x threshold.
	resp := investmentHoldingsResponse("VTI", 210)
	draft := reconcileHolding(t, adapter, resp)
	if draft.Decision != wealth.DecisionFlagged || draft.Review == nil {
		t.Fatalf("draft = %#v", draft)
	}
	if draft.BalanceUSD != money.FromDollars(20) || draft.CarryUSD != money.FromDollars(20) || len(draft.Holdings) != 1 {
		t.Fatalf("carried snapshot = %#v", draft.AccountBalanceSnapshot)
	}
	if draft.Review.ProviderBalanceUSD != money.FromDollars(2100) || draft.Review.CarryForwardBalanceUSD != money.FromDollars(20) {
		t.Fatalf("review = %#v", draft.Review)
	}
	if draft.ProviderState == nil || draft.ProviderState.ProviderHoldingsJSON == "" {
		t.Fatal("expected provider state holdings JSON")
	}
}

func TestReconcileHoldingsAutoCarriesForwardWhenApprovedReviewMatches(t *testing.T) {
	store := &readStore{
		asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)},
		prior: priorSnapshotWithHolding("VTI", 2, 20),
		approved: &wealth.ApprovedBalanceReview{
			ProviderBalanceUSD: money.FromDollars(2100),
		},
	}
	adapter := newTestAdapter(nil, store, nil, &recordingPriceProvider{price: 210}, testutil.Logger)

	resp := investmentHoldingsResponse("VTI", 210)
	draft := reconcileHolding(t, adapter, resp)
	if draft.Decision != wealth.DecisionApprovedCarryForward || draft.Review != nil || draft.ProviderState != nil {
		t.Fatalf("draft = %#v", draft)
	}
	if draft.BalanceUSD != money.FromDollars(20) {
		t.Fatalf("balance = %v, want carried-forward 20", draft.BalanceUSD)
	}
	if draft.FlagReason == "" || draft.FlagReason == "auto-carry-forward: approved review matches provider value" {
		t.Fatalf("flag reason = %q, want current anomaly reason", draft.FlagReason)
	}
}

func TestReconcileHoldingsStablePricesStayClean(t *testing.T) {
	store := &readStore{
		asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)},
		prior: priorSnapshotWithHolding("VTI", 200, 2000),
	}
	adapter := newTestAdapter(nil, store, nil, &recordingPriceProvider{price: 210}, testutil.Logger)

	resp := investmentHoldingsResponse("VTI", 210)
	draft := reconcileHolding(t, adapter, resp)
	if draft.Decision != wealth.DecisionClean || draft.Review != nil {
		t.Fatalf("draft = %#v", draft)
	}
	if draft.BalanceUSD != money.FromDollars(2100) || len(draft.Holdings) != 1 {
		t.Fatalf("clean snapshot = %#v", draft.AccountBalanceSnapshot)
	}
	if !draft.Anchor.Found || draft.Anchor.AmountUSD != money.FromDollars(2000) {
		t.Fatalf("anchor = %#v, want prior carried for recovery", draft.Anchor)
	}
}

func priorSnapshotWithHolding(identifier string, price, valueUSD float64) wealth.LastUnflaggedSnapshotResult {
	quantity := valueUSD / price
	return wealth.LastUnflaggedSnapshotResult{
		Found:     true,
		AmountUSD: money.FromDollars(valueUSD),
		Date:      "2026-05-31",
		Holdings: []wealth.AssetDailyHolding{{
			AssetID:           1,
			Identifier:        identifier,
			Quantity:          &quantity,
			Price:             &price,
			ValueUSD:          valueUSD,
			CountsTowardValue: true,
		}},
	}
}

func depositoryAccountWithBalance() plaidapi.AccountBase {
	return accountWithBalance("acc", plaidapi.ACCOUNTTYPE_DEPOSITORY, 42)
}

func accountWithBalance(accountID string, accountType plaidapi.AccountType, currentBalance float64) plaidapi.AccountBase {
	account := testutil.AccountBase(accountID, "", "", string(accountType), "")
	balance := plaidapi.NewAccountBalanceWithDefaults()
	balance.SetCurrent(currentBalance)
	account.SetBalances(*balance)
	return account
}

func investmentHoldingsResponse(ticker string, institutionPrice float64) plaidapi.InvestmentsHoldingsGetResponse {
	const accountID = "acc-with"
	const quantity = 10
	account := testutil.AccountBase(accountID, "", "", string(plaidapi.ACCOUNTTYPE_INVESTMENT), "")
	security := plaidapi.NewSecurityWithDefaults()
	security.SetSecurityId("sec-1")
	security.SetTickerSymbol(ticker)
	holding := plaidapi.NewHoldingWithDefaults()
	holding.SetAccountId(accountID)
	holding.SetSecurityId("sec-1")
	holding.SetQuantity(quantity)
	holding.SetInstitutionPrice(institutionPrice)
	return plaidapi.InvestmentsHoldingsGetResponse{
		Accounts:   []plaidapi.AccountBase{account},
		Securities: []plaidapi.Security{*security},
		Holdings:   []plaidapi.Holding{*holding},
	}
}

func testEventSink() *testutil.EventSink[wealth.PersistEvent] {
	return &testutil.EventSink[wealth.PersistEvent]{
		TodayValue: "2026-06-01",
		NowValue:   time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC),
	}
}

func reconcilePersistedHolding(t *testing.T, persisted *model.Asset, providerPrice, institutionPrice float64) (*wealth.SnapshotDraft, *recordingPriceProvider) {
	t.Helper()
	prices := &recordingPriceProvider{price: providerPrice}
	store := &readStore{asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)}, bySource: persisted}
	adapter := newTestAdapter(nil, store, nil, prices, testutil.Logger)
	response := investmentHoldingsResponse("vti", institutionPrice)
	response.Securities[0].SetName("Vanguard Total Stock Market")
	return reconcileHolding(t, adapter, response), prices
}

func reconcileHolding(t *testing.T, adapter *Adapter, response plaidapi.InvestmentsHoldingsGetResponse) *wealth.SnapshotDraft {
	t.Helper()
	events := make(chan wealth.PersistEvent, 1)
	must.NoErr(t, adapter.reconcileHoldings(context.Background(), response, nil, nil, testEventSink(), events))
	return (<-events).Snapshot
}

func TestHandleEmptyInvestmentHoldingsCarriesForwardAndFlags(t *testing.T) {
	ctx := context.Background()
	quantity := 2.0
	currentPrice := 9.0
	priorPrice := 4.0
	store := &readStore{
		asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1), CurrentPrice: &currentPrice},
		prior: wealth.LastUnflaggedSnapshotResult{
			Found: true,
			Date:  "2026-05-31",
			Holdings: []wealth.AssetDailyHolding{{
				AssetID:           1,
				Quantity:          &quantity,
				Price:             &priorPrice,
				ValueUSD:          8,
				CountsTowardValue: true,
			}},
		},
	}
	adapter := newTestAdapter(nil, store, nil, &recordingPriceProvider{price: 11}, testutil.Logger)
	events := make(chan wealth.PersistEvent, 1)
	sink := testEventSink()
	balance := 50.0

	written, err := adapter.handleEmptyInvestmentHoldings(
		ctx,
		1,
		&balance,
		"2026-06-01",
		sink.Now().Format(time.RFC3339),
		nil,
		events,
	)
	if err != nil || !written {
		t.Fatalf("handleEmptyInvestmentHoldings() written=%v err=%v", written, err)
	}
	draft := (<-events).Snapshot
	if draft.Decision != wealth.DecisionFlagged || draft.Review == nil || draft.CarryUSD != money.FromDollars(22) {
		t.Fatalf("draft = %#v", draft)
	}
	if len(draft.Holdings) != 1 || draft.Holdings[0].Price == nil || *draft.Holdings[0].Price != 11 {
		t.Fatalf("holdings = %#v", draft.Holdings)
	}
}

type recordingPriceProvider struct {
	price float64
	err   error
	calls int
	seen  []*model.Asset
}

func newTestAdapter(
	plaidStore PlaidBalanceStore,
	reads ReadStore,
	clients clientspkg.PlaidClientFactory,
	prices wealth.PriceProvider,
	log *slog.Logger,
) *Adapter {
	if prices == nil {
		prices = testutil.LastKnownPriceProvider{}
	}
	return &Adapter{
		Reads: reads, Log: log,
		plaid:   plaidStore,
		clients: clients,
		prices:  prices,
		reads:   reads,
	}
}

func (p *recordingPriceProvider) PriceAt(_ context.Context, asset *model.Asset, _ time.Time) (float64, error) {
	p.calls++
	p.seen = append(p.seen, asset)
	return p.price, p.err
}

type readStore struct {
	accountIDs   map[string]int64
	accountTypes map[string]model.AccountType
	accountErr   error
	asset        *model.Asset
	// bySource is returned from AssetByAdapterSource; nil simulates "not yet
	// discovered", falling back to the transient provider-derived asset.
	bySource *model.Asset
	prior    wealth.LastUnflaggedSnapshotResult
	approved *wealth.ApprovedBalanceReview
}

func (s *readStore) AssetByID(context.Context, int64) (*model.Asset, error) { return s.asset, nil }
func (s *readStore) AssetByAdapterSource(context.Context, wealth.AdapterSource) (*model.Asset, error) {
	return s.bySource, nil
}
func (s *readStore) AccountByID(_ context.Context, id int64) (*model.Account, error) {
	return &model.Account{ID: model.New(model.GlobalIDAccount, id)}, nil
}
func (s *readStore) AccountByExternalID(_ context.Context, externalID string) (int64, model.AccountType, error) {
	if s.accountErr != nil {
		return 0, "", s.accountErr
	}
	defaults := map[string]int64{"acc": 1, "acc-with": 1, "acc-empty": 2}
	id, err := testutil.FakeAccountIDByExternalID(externalID, s.accountIDs, defaults)
	accountType := s.accountTypes[externalID]
	if accountType == "" {
		accountType = model.AccountTypeDepository
	}
	return id, accountType, err
}
func (s *readStore) LatestUnflaggedSnapshotWithHoldings(context.Context, int64, string) (wealth.LastUnflaggedSnapshotResult, error) {
	return s.prior, nil
}
func (s *readStore) GetApprovedBalanceReviewByAccount(context.Context, int64) (*wealth.ApprovedBalanceReview, error) {
	return s.approved, nil
}

type plaidStore struct {
	reads       readStore
	items       []accounts.PlaidItemSecret
	dueCalls    int
	syncedCalls int
}

func (s *plaidStore) BalanceSyncScheduleCron(context.Context, syncerids.ID) (string, error) {
	return "0 0 * * *", nil
}

func (s *plaidStore) PlaidItemsDueForBalanceSync(context.Context, time.Time) ([]accounts.PlaidItemSecret, error) {
	s.dueCalls++
	return s.items, nil
}
func (s *plaidStore) PlaidItemSecretByID(_ context.Context, itemID int64) (*accounts.PlaidItemSecret, error) {
	for _, item := range s.items {
		if item.ID == itemID {
			return &item, nil
		}
	}
	return nil, nil
}
func (s *plaidStore) SetItemBalanceSynced(context.Context, int64, time.Time) error {
	s.syncedCalls++
	return nil
}
func (s *plaidStore) AssetByID(ctx context.Context, id int64) (*model.Asset, error) {
	return s.reads.AssetByID(ctx, id)
}
func (s *plaidStore) AccountByID(ctx context.Context, id int64) (*model.Account, error) {
	return s.reads.AccountByID(ctx, id)
}
func (s *plaidStore) AccountByExternalID(ctx context.Context, externalID string) (int64, model.AccountType, error) {
	return s.reads.AccountByExternalID(ctx, externalID)
}
func (s *plaidStore) LatestUnflaggedSnapshotWithHoldings(ctx context.Context, accountID int64, date string) (wealth.LastUnflaggedSnapshotResult, error) {
	return s.reads.LatestUnflaggedSnapshotWithHoldings(ctx, accountID, date)
}
func (s *plaidStore) GetApprovedBalanceReviewByAccount(ctx context.Context, accountID int64) (*wealth.ApprovedBalanceReview, error) {
	return s.reads.GetApprovedBalanceReviewByAccount(ctx, accountID)
}
func (s *plaidStore) AssetByAdapterSource(ctx context.Context, source wealth.AdapterSource) (*model.Asset, error) {
	return s.reads.AssetByAdapterSource(ctx, source)
}

type clientFactory struct {
	client clientspkg.PlaidClient
	calls  int
}

func (f *clientFactory) ClientForCredential(context.Context, int32) (clientspkg.PlaidClient, error) {
	f.calls++
	return f.client, nil
}

func plaidBalanceClient(accounts []plaidapi.AccountBase, balanceErrors map[string]error) testutil.PlaidClientStub {
	return testutil.PlaidClientStub{
		AccountsFn: func(context.Context, string) ([]plaidapi.AccountBase, error) {
			return accounts, nil
		},
		AccountsBalanceGetFn: func(_ context.Context, accessToken string) ([]plaidapi.AccountBase, error) {
			if err, ok := balanceErrors[accessToken]; ok {
				return nil, err
			}
			return accounts, nil
		},
	}
}
