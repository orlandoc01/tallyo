package simplefin

import (
	"context"
	"database/sql"
	"math"
	"strconv"
	"testing"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/clients"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	testutil "tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	wealthdb "tallyo/internal/wealth/db"
	"tallyo/internal/wealth/syncerids"
)

func TestSyncDueAndConnectionUseTokenStore(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	store := &simpleFinStore{
		tokens: []accounts.SimpleFinAccessTokenSecret{{ID: 7, AccessURL: "https://u:p@example.test"}},
		asset:  &model.Asset{ID: model.New(model.GlobalIDAsset, 1)},
	}
	client := &simpleFinClient{accounts: clients.SimpleFinAccountSet{Accounts: []clients.SimpleFinAccount{{
		ID:      "acc",
		Name:    "Joint Checking",
		Balance: "42.50",
	}}}}
	adapter := newTestAdapter(store, client)
	sink := &testutil.EventSink[wealth.PersistEvent]{TodayValue: "2026-06-01", NowValue: now}

	must.NoErr(t, adapter.SyncDue(ctx, sink))
	must.NoErr(t, adapter.SyncConnectionInto(ctx, wealth.ConnectionRef{SourceID: 1}, sink))

	handlesSimpleFin, err := adapter.Handles(ctx, wealth.ConnectionRef{SourceTable: accounts.SourceTableSimpleFinConnection})
	must.NoErr(t, err)
	handlesPlaid, err := adapter.Handles(ctx, wealth.ConnectionRef{SourceTable: accounts.SourceTablePlaidItem})
	must.NoErr(t, err)
	if !handlesSimpleFin || handlesPlaid {
		t.Fatal("provider routing mismatch")
	}
	if store.dueCalls != 1 || store.connCalls != 1 || store.syncedCalls != 2 {
		t.Fatalf(
			"calls due=%d conn=%d synced=%d",
			store.dueCalls,
			store.connCalls,
			store.syncedCalls,
		)
	}
	if client.calls != 2 || len(sink.Events) != 2 {
		t.Fatalf("client calls=%d events=%d", client.calls, len(sink.Events))
	}
	for _, event := range sink.Events {
		if event.Snapshot == nil || event.Snapshot.Source != "simplefin" || event.Snapshot.BalanceUSD != money.FromDollars(42.50) {
			t.Fatalf("event = %#v", event)
		}
	}
}

func TestSyncDueContinuesAfterTokenError(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	store := &simpleFinStore{
		tokens: []accounts.SimpleFinAccessTokenSecret{
			{ID: 1, AccessURL: "bad"},
			{ID: 2, AccessURL: "good"},
		},
		asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)},
	}
	client := &simpleFinClient{
		accounts: clients.SimpleFinAccountSet{Accounts: []clients.SimpleFinAccount{{
			ID:      "acc",
			Name:    "Joint Checking",
			Balance: "42.50",
		}}},
		errors: map[string]error{"bad": strconv.ErrSyntax},
	}
	adapter := newTestAdapter(store, client)
	sink := &testutil.EventSink[wealth.PersistEvent]{TodayValue: "2026-06-01", NowValue: now}

	must.NoErr(t, adapter.SyncDue(ctx, sink))
	if client.calls != 2 || store.syncedCalls != 1 || len(sink.Events) != 1 {
		t.Fatalf("client=%d synced=%d events=%d", client.calls, store.syncedCalls, len(sink.Events))
	}
}

func TestSyncDueUsesGlobalBalanceScheduleCron(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t)
	db := store.Database()
	accountsStore := accountsdb.New(db)
	owner := testutil.MustCreateOwner(t, accountsStore, model.CreateOwnerInput{Name: "simplefin-schedule-owner"})
	token, err := accountsStore.CreateSimpleFinAccessToken(
		ctx,
		"https://u:p@example.test",
		owner.ID.Int64(),
		"Bridge",
	)
	must.NoErr(t, err)
	if _, err := accountsStore.UpsertAccountWithExternalID(ctx, "acc", &model.Account{
		Owner: owner,
		Name:  "Joint Checking",
		Type:  model.AccountTypeDepository,
	}); err != nil {
		t.Fatalf("UpsertAccountWithExternalID: %v", err)
	}
	if _, err := store.SQL().ExecContext(
		ctx,
		`UPDATE balance_sync_schedules SET balance_sync_cron = '0 9 * * *' WHERE id = 'simplefin'`,
	); err != nil {
		t.Fatalf("update simplefin balance schedule: %v", err)
	}
	client := &simpleFinClient{accounts: clients.SimpleFinAccountSet{Accounts: []clients.SimpleFinAccount{{
		ID:      "acc",
		Name:    "Joint Checking",
		Balance: "42.50",
	}}}}
	adapter := New(wealthdb.New(db), client, testutil.Logger)
	sink := &testutil.EventSink[wealth.PersistEvent]{TodayValue: "2026-06-01", NowValue: time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)}

	must.NoErr(t, adapter.SyncDue(ctx, sink))
	tokenID := token.ID.Int64()
	expected := time.Date(2026, 6, 1, 13, 0, 0, 0, time.UTC)
	secrets, err := adapter.store.SimpleFinTokensDueForBalanceSync(ctx, expected)
	must.NoErr(t, err)
	if len(secrets) != 1 || secrets[0].ID != int64(tokenID) || secrets[0].NextBalanceSyncAt == nil || !secrets[0].NextBalanceSyncAt.Equal(expected) {
		t.Fatalf("SimpleFinTokensDueForBalanceSync = %#v, want next %v", secrets, expected)
	}
}

func TestReconcileAccountsMapsSimpleFinBalancesAndHoldings(t *testing.T) {
	ctx := context.Background()
	adapter := newTestAdapter(&simpleFinStore{
		asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)},
		accountTypes: map[int64]model.AccountType{
			1: model.AccountTypeDepository,
			2: model.AccountTypeCredit,
		},
	}, nil)
	events := make(chan wealth.PersistEvent, 4)
	sink := &testutil.EventSink[wealth.PersistEvent]{
		TodayValue: "2026-06-01",
		NowValue:   time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC),
	}
	accounts := []clients.SimpleFinAccount{
		{ID: "checking", Name: "Joint Checking", Balance: "-106.17"},
		{ID: "card", Name: "Credit Card", Balance: "-1031.54"},
		{
			ID:          "ira",
			Name:        "ROTH IRA",
			Balance:     "1305.75",
			BalanceDate: time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC).Unix(),
			Holdings: []clients.SimpleFinHolding{
				{ID: "h1", Symbol: "aapl", Description: "Apple Inc", Shares: "2", MarketValue: "300", Currency: "USD"},
				{ID: "h2", Symbol: "SPAXX", Description: "Fidelity Government Money Market", Shares: "0.74", MarketValue: "0.74", Currency: "USD"},
				{ID: "h3", Description: "Private Fund", Shares: "5", MarketValue: "1000", CostBasis: "900.00", PurchasePrice: "180.00"},
				{ID: "closed", Symbol: "FDRXX", Description: "Closed", Shares: "0.00", MarketValue: "0.00"},
			},
		},
	}

	must.NoErr(t, adapter.reconcileAccounts(ctx, accounts, sink, events))
	close(events)

	snapshots := map[int64]*wealth.SnapshotDraft{}
	for event := range events {
		snapshots[event.Snapshot.AccountID] = event.Snapshot
	}
	if snapshots[1].BalanceUSD != money.FromDollars(-106.17) {
		t.Fatalf("checking balance = %v", snapshots[1].BalanceUSD)
	}
	if snapshots[2].BalanceUSD != money.FromDollars(1031.54) {
		t.Fatalf("card balance = %v", snapshots[2].BalanceUSD)
	}

	investment := snapshots[3]
	if investment.BalanceUSD != money.FromDollars(1305.75) || len(investment.Holdings) != 4 {
		t.Fatalf("investment snapshot = %#v", investment)
	}
	holdings := holdingsByIdentifier(investment.Holdings)
	if holdings["AAPL"].Asset.TrackingTicker != nil {
		t.Fatalf("AAPL holding = %#v", holdings["AAPL"])
	}
	if holdings["AAPL"].Asset.AdapterSource == nil || holdings["AAPL"].Asset.AdapterSource.Adapter != syncerids.SimpleFin || holdings["AAPL"].Asset.AdapterSource.SourceID != "h1" {
		t.Fatalf("AAPL adapter source = %#v", holdings["AAPL"].Asset.AdapterSource)
	}
	if holdings["SPAXX"].Asset.Classifier != model.AssetClassifierCash || holdings["SPAXX"].Asset.TrackingTicker != nil {
		t.Fatalf("SPAXX holding = %#v", holdings["SPAXX"])
	}
	custom := holdings["simplefin:h3"]
	if custom.Asset == nil || custom.Price == nil || *custom.Price != 200 {
		t.Fatalf("custom holding = %#v", custom)
	}
	if custom.Asset.SimpleFinCostBasis == nil || *custom.Asset.SimpleFinCostBasis != "900.00" {
		t.Fatalf("custom asset additional fields = %#v", custom.Asset)
	}
	if custom.Asset.AdapterSource == nil || custom.Asset.AdapterSource.Adapter != syncerids.SimpleFin || custom.Asset.AdapterSource.SourceID != "h3" {
		t.Fatalf("custom adapter source = %#v", custom.Asset.AdapterSource)
	}
	if residual := holdings["1"]; math.Abs(residual.ValueUSD-5.01) > 0.0001 {
		t.Fatalf("residual cash = %#v", residual)
	}
}

func TestReconcileFlagsHoldingPriceDeviationAndRaisesReview(t *testing.T) {
	priorPrice := 1.0
	adapter := newTestAdapter(&simpleFinStore{
		asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)},
		prior: wealth.LastUnflaggedSnapshotResult{
			Found:     true,
			AmountUSD: money.FromDollars(100),
			Date:      "2026-05-31",
			Holdings:  []wealth.AssetDailyHolding{{Identifier: "VTI", Price: &priorPrice}},
		},
	}, nil)
	draft := reconcileAccount(t, adapter, iraAccount("150.00", "1", "150.00"))
	if draft.Decision != wealth.DecisionFlagged {
		t.Fatalf("decision = %v, want DecisionFlagged", draft.Decision)
	}
	if draft.CarryUSD != money.FromDollars(100) || draft.BalanceUSD != money.FromDollars(100) {
		t.Fatalf("carry-forward balance = %v / %v, want 100", draft.CarryUSD, draft.BalanceUSD)
	}
	if draft.Review == nil {
		t.Fatal("expected a balance review to be raised")
	}
	if draft.Review.ProviderBalanceUSD != money.FromDollars(150) || draft.Review.CarryForwardBalanceUSD != money.FromDollars(100) {
		t.Fatalf("review = %#v", draft.Review)
	}
}

func TestReconcileAutoCarriesForwardWhenApprovedReviewMatches(t *testing.T) {
	priorPrice := 1.0
	adapter := newTestAdapter(&simpleFinStore{
		asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)},
		prior: wealth.LastUnflaggedSnapshotResult{
			Found:     true,
			AmountUSD: money.FromDollars(100),
			Date:      "2026-05-31",
			Holdings:  []wealth.AssetDailyHolding{{Identifier: "VTI", Price: &priorPrice}},
		},
		approvedReview: &wealth.ApprovedBalanceReview{
			ProviderBalanceUSD: money.FromDollars(150),
		},
	}, nil)
	draft := reconcileAccount(t, adapter, iraAccount("150.00", "1", "150.00"))
	if draft.Decision != wealth.DecisionApprovedCarryForward {
		t.Fatalf("decision = %v, want DecisionApprovedCarryForward", draft.Decision)
	}
	if draft.Review != nil {
		t.Fatalf("expected no new review, got %#v", draft.Review)
	}
	if draft.BalanceUSD != money.FromDollars(100) {
		t.Fatalf("balance = %v, want carried-forward 100", draft.BalanceUSD)
	}
	if draft.FlagReason == "" || draft.FlagReason == "auto-carry-forward: approved review matches provider value" {
		t.Fatalf("flag reason = %q, want current anomaly reason", draft.FlagReason)
	}
}

func TestReconcileDoesNotFlagBalanceOnlySpike(t *testing.T) {
	usdPrice := 1.0
	adapter := newTestAdapter(&simpleFinStore{
		asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)},
		prior: wealth.LastUnflaggedSnapshotResult{
			Found:     true,
			AmountUSD: money.FromDollars(100),
			Date:      "2026-05-31",
			Holdings:  []wealth.AssetDailyHolding{{AssetID: 1, Price: &usdPrice, ValueUSD: 100}},
		},
	}, nil)
	draft := reconcileAccount(t, adapter, clients.SimpleFinAccount{ID: "checking", Name: "Joint Checking", Balance: "50000.00"})
	if draft.Decision != wealth.DecisionClean {
		t.Fatalf("decision = %v, want DecisionClean", draft.Decision)
	}
	if draft.BalanceUSD != money.FromDollars(50000) {
		t.Fatalf("balance = %v, want provider balance 50000", draft.BalanceUSD)
	}
	if draft.Review != nil {
		t.Fatalf("expected no balance review, got %#v", draft.Review)
	}
}

func TestSyncTokenDoesNotConfirmWhenPersistFails(t *testing.T) {
	ctx := context.Background()
	store := &simpleFinStore{
		tokens: []accounts.SimpleFinAccessTokenSecret{{ID: 7, AccessURL: "https://u:p@example.test"}},
		asset:  &model.Asset{ID: model.New(model.GlobalIDAsset, 1)},
	}
	client := &simpleFinClient{accounts: clients.SimpleFinAccountSet{Accounts: []clients.SimpleFinAccount{{
		ID:      "acc",
		Name:    "Joint Checking",
		Balance: "42.50",
	}}}}
	adapter := newTestAdapter(store, client)
	sink := &testutil.EventSink[wealth.PersistEvent]{TodayValue: "2026-06-01", NowValue: time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC), Err: context.Canceled}

	err := adapter.SyncTokenInto(ctx, store.tokens[0], "0 0 * * *", sink)
	if err == nil || store.syncedCalls != 0 {
		t.Fatalf("err=%v syncedCalls=%d, want persist error and no confirmation", err, store.syncedCalls)
	}
}

func newTestAdapter(store *simpleFinStore, client clients.SimpleFinClient) *Adapter {
	return &Adapter{
		BaseAdapter: wealth.BaseAdapter{Reads: store, Log: testutil.Logger},
		store:       store,
		client:      client,
	}
}

func iraAccount(balance, shares, marketValue string) clients.SimpleFinAccount {
	return clients.SimpleFinAccount{
		ID:      "ira",
		Name:    "ROTH IRA",
		Balance: balance,
		Holdings: []clients.SimpleFinHolding{{
			ID:          "h1",
			Symbol:      "VTI",
			Description: "Vanguard Total Stock Market ETF",
			Shares:      shares,
			MarketValue: marketValue,
		}},
	}
}

func reconcileAccount(t *testing.T, adapter *Adapter, account clients.SimpleFinAccount) *wealth.SnapshotDraft {
	t.Helper()
	events := make(chan wealth.PersistEvent, 1)
	sink := &testutil.EventSink[wealth.PersistEvent]{TodayValue: "2026-06-01", NowValue: time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)}
	must.NoErr(t, adapter.reconcileAccounts(context.Background(), []clients.SimpleFinAccount{account}, sink, events))
	close(events)
	return (<-events).Snapshot
}

func TestIdentifierForHoldingFallsBackToUniqueID(t *testing.T) {
	cases := []struct {
		name    string
		symbol  string
		holding clients.SimpleFinHolding
		want    string
	}{
		{
			name:   "symbol wins",
			symbol: "AAPL",
			holding: clients.SimpleFinHolding{
				ID: "h1", Description: "Apple Inc",
			},
			want: "AAPL",
		},
		{
			name: "untickered keys on unique id, not description slug",
			holding: clients.SimpleFinHolding{
				ID: "h3", Description: "Private Fund",
			},
			want: "simplefin:h3",
		},
		{
			name: "untickered with no id falls back to description slug",
			holding: clients.SimpleFinHolding{
				Description: "Private Fund",
			},
			want: "simplefin:private-fund",
		},
		{
			name:    "no symbol, id, or description",
			holding: clients.SimpleFinHolding{},
			want:    "simplefin:unknown-holding",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := identifierForHolding(tc.symbol, tc.holding); got != tc.want {
				t.Fatalf("identifierForHolding() = %q, want %q", got, tc.want)
			}
		})
	}
}

func holdingsByIdentifier(holdings []wealth.AssetDailyHolding) map[string]wealth.AssetDailyHolding {
	byID := map[string]wealth.AssetDailyHolding{}
	for _, holding := range holdings {
		if holding.Asset != nil {
			byID[holding.Asset.Identifier] = holding
			continue
		}
		byID[strconv.FormatInt(holding.AssetID, 10)] = holding
	}
	return byID
}

type simpleFinStore struct {
	tokens         []accounts.SimpleFinAccessTokenSecret
	asset          *model.Asset
	accountIDs     map[string]int64
	accountTypes   map[int64]model.AccountType
	prior          wealth.LastUnflaggedSnapshotResult
	approvedReview *wealth.ApprovedBalanceReview
	dueCalls       int
	connCalls      int
	syncedCalls    int
}

func (s *simpleFinStore) AccountByID(_ context.Context, id int64) (*model.Account, error) {
	accountType, ok := s.accountTypes[id]
	if !ok {
		return nil, sql.ErrNoRows
	}
	return &model.Account{ID: model.New(model.GlobalIDAccount, id), Type: accountType}, nil
}

func (s *simpleFinStore) AccountByExternalID(_ context.Context, externalID string) (int64, model.AccountType, error) {
	defaults := map[string]int64{"checking": 1, "acc": 1, "card": 2, "ira": 3}
	id, err := testutil.FakeAccountIDByExternalID(externalID, s.accountIDs, defaults)
	accountType := s.accountTypes[id]
	if accountType == "" {
		accountType = model.AccountTypeDepository
	}
	return id, accountType, err
}

func (s *simpleFinStore) SimpleFinTokensDueForBalanceSync(
	context.Context,
	time.Time,
) ([]accounts.SimpleFinAccessTokenSecret, error) {
	s.dueCalls++
	return s.tokens, nil
}

func (s *simpleFinStore) SimpleFinTokenSecretByConnID(
	_ context.Context,
	_ int64,
) (*accounts.SimpleFinAccessTokenSecret, error) {
	s.connCalls++
	if len(s.tokens) == 0 {
		return nil, nil
	}
	return &s.tokens[0], nil
}

func (s *simpleFinStore) SetSimpleFinTokenBalanceSynced(context.Context, int64, time.Time) error {
	s.syncedCalls++
	return nil
}

func (s *simpleFinStore) BalanceSyncScheduleCron(context.Context, syncerids.ID) (string, error) {
	return "0 0 * * *", nil
}

func (s *simpleFinStore) AssetByID(context.Context, int64) (*model.Asset, error) {
	return s.asset, nil
}

func (s *simpleFinStore) LatestUnflaggedSnapshotWithHoldings(
	context.Context,
	int64,
	string,
) (wealth.LastUnflaggedSnapshotResult, error) {
	return s.prior, nil
}

func (s *simpleFinStore) GetApprovedBalanceReviewByAccount(
	context.Context,
	int64,
) (*wealth.ApprovedBalanceReview, error) {
	return s.approvedReview, nil
}

type simpleFinClient struct {
	accounts clients.SimpleFinAccountSet
	errors   map[string]error
	calls    int
}

func (c *simpleFinClient) Claim(context.Context, string) (string, error) {
	return "", nil
}

func (c *simpleFinClient) GetAccounts(
	_ context.Context,
	accessURL string,
	_ clients.GetAccountsOpts,
) (clients.SimpleFinAccountSet, error) {
	c.calls++
	if err, ok := c.errors[accessURL]; ok {
		return clients.SimpleFinAccountSet{}, err
	}
	return c.accounts, nil
}
