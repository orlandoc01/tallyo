package transactions_test

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/clients"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"
	transactionsdb "tallyo/internal/transactions/db"
	"tallyo/internal/transactions/txnsync"
	"tallyo/internal/utils/test"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"tallyo/internal/utils/must"
)

type fakeClient struct{ test.PlaidClientStub }

type testSyncerConfig struct {
	now func() time.Time
	log *slog.Logger
}

type testSyncerOption func(*testSyncerConfig)

func newTestSyncer(
	store *transactionsTestStore,
	client clients.PlaidClient,
	opts ...testSyncerOption,
) *txnsync.Syncer {
	cfg := testSyncerConfig{log: test.Logger}
	for _, opt := range opts {
		opt(&cfg)
	}
	return txnsync.New(store.Database(), txnsync.Config{
		Clients: test.StaticClientFactory{Client: client},
		Now:     cfg.now,
	}, cfg.log)
}

type seededSyncFixture struct {
	store  *transactionsTestStore
	itemID int64
	syncer *txnsync.Syncer
}

func newSeededSyncFixture(t *testing.T, client clients.PlaidClient, opts ...testSyncerOption) seededSyncFixture {
	t.Helper()
	store := openTransactionsTestStore(t, ":memory:")
	itemID := seedPlaidItem(t, store, "item")
	return seededSyncFixture{store: store, itemID: itemID, syncer: newTestSyncer(store, client, opts...)}
}

func withNow(now func() time.Time) testSyncerOption {
	return func(cfg *testSyncerConfig) {
		cfg.now = now
	}
}

func withLog(log *slog.Logger) testSyncerOption {
	return func(cfg *testSyncerConfig) {
		cfg.log = log
	}
}

func (fakeClient) Accounts(ctx context.Context, accessToken string) ([]plaidapi.AccountBase, error) {
	return []plaidapi.AccountBase{test.AccountBase("acc", "Checking", "0000", "depository", "checking")}, nil
}

func (c fakeClient) AccountsBalanceGet(ctx context.Context, accessToken string) ([]plaidapi.AccountBase, error) {
	return c.Accounts(ctx, accessToken)
}

func (fakeClient) Sync(ctx context.Context, accessToken, cursor string) (plaidapi.TransactionsSyncResponse, error) {
	tx := plaidapi.NewTransactionWithDefaults()
	tx.SetTransactionId("tx")
	tx.SetAccountId("acc")
	tx.SetAmount(10)
	tx.SetDate("2026-05-20")
	tx.SetName("Grocery")
	return plaidapi.TransactionsSyncResponse{Added: []plaidapi.Transaction{*tx}, NextCursor: "next", HasMore: false}, nil
}

func (fakeClient) Institution(ctx context.Context, institutionID string) (plaidapi.Institution, error) {
	institution := plaidapi.NewInstitutionWithDefaults()
	institution.SetName("Institution")
	institution.SetUrl("institution.example")
	return *institution, nil
}

func (fakeClient) ItemGet(ctx context.Context, accessToken string) (plaidapi.Item, error) {
	products := []plaidapi.Products{plaidapi.PRODUCTS_INVESTMENTS, plaidapi.PRODUCTS_TRANSACTIONS}
	return plaidapi.Item{BilledProducts: products, Products: &products}, nil
}

func TestSyncDueItemsPersistsTransactions(t *testing.T) {
	ctx := context.Background()
	fixture := newSeededSyncFixture(t, fakeClient{})
	result := fixture.syncer.SyncDueItems(ctx)
	if len(result.Items) != 1 || result.TotalAdded != 1 || result.Items[0].Error != nil {
		t.Fatalf("SyncDueItems() = %#v", result)
	}
	transaction := test.MustTransactionBySourceExternalID(t, fixture.store, transactions.TransactionSourcePlaid, "tx", "Transaction() error = %v")
	if transaction == nil || transaction.Account.Owner == nil || transaction.Account.Owner.Name != "alex" || transaction.Account.Connection == nil {
		t.Fatalf("transaction = %#v", transaction)
	}
	rawProviderJSON, err := fixture.store.TransactionRawProviderJSON(ctx, "tx")
	must.NoErr(t, err)
	if !strings.Contains(rawProviderJSON, `"transaction_id":"tx"`) {
		t.Fatalf("raw_provider_json = %s", rawProviderJSON)
	}
}

func TestSyncDueItemsWritesSyncLog(t *testing.T) {
	ctx := context.Background()
	fixture := newSeededSyncFixture(t, fakeClient{})
	result := fixture.syncer.SyncDueItems(ctx)
	if len(result.Items) != 1 || result.Items[0].Error != nil {
		t.Fatalf("SyncDueItems() = %#v", result)
	}

	added, modified, removed, err := fixture.store.PlaidSyncLogEntry(ctx, fixture.itemID)
	must.NoErr(t, err)
	if !strings.Contains(added, `"tx"`) {
		t.Errorf("added log missing transaction id, got: %s", added)
	}
	if modified != "[]" {
		t.Errorf("modified = %s, want []", modified)
	}
	if removed != "[]" {
		t.Errorf("removed = %s, want []", removed)
	}
}

func TestSyncDueItemsSegregatesInvestmentTransactions(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 6, 20, 12, 0, 0, 0, time.UTC)
	client := &investmentTransactionsClient{}
	fixture := newSeededSyncFixture(t, client, withNow(func() time.Time { return now }))
	must.NoErr(t, fixture.store.Accounts.SetPlaidProductFlags(ctx, fixture.itemID, true, false))
	logoURL := "https://icons.duckduckgo.com/ip3/chase.com.ico"
	must.NoErr(t, fixture.store.Accounts.SetPlaidItemLogoURL(ctx, fixture.itemID, &logoURL))
	if _, err := fixture.store.SQL().ExecContext(ctx, `UPDATE connections SET name = 'Chase' WHERE source_table = 'plaid_items' AND source_id = ?`, fixture.itemID); err != nil {
		t.Fatalf("set institution name: %v", err)
	}

	result := fixture.syncer.SyncDueItems(ctx)
	if len(result.Items) != 1 || result.Items[0].Error != nil {
		t.Fatalf("SyncDueItems() = %#v", result)
	}
	if result.TotalAdded != 2 || result.TotalRemoved != 1 {
		t.Fatalf("sync counts = added %d modified %d removed %d", result.TotalAdded, result.TotalModified, result.TotalRemoved)
	}
	if client.startDate != "2026-05-21" || client.endDate != "2026-06-20" {
		t.Fatalf("investment date range = %s..%s", client.startDate, client.endDate)
	}
	if strings.Join(client.accountIDs, ",") != "invest" {
		t.Fatalf("investment account ids = %#v", client.accountIDs)
	}

	investmentTxn, err := test.TransactionBySourceExternalID(ctx, fixture.store, transactions.TransactionSourcePlaid, "itx")
	if err != nil || investmentTxn == nil {
		t.Fatalf("investment transaction = %#v, %v", investmentTxn, err)
	}
	if investmentTxn.MerchantName == nil || *investmentTxn.MerchantName != "Chase - Treasury ETF (SGOV)" {
		t.Fatalf("investment merchant = %#v", investmentTxn.MerchantName)
	}
	if investmentTxn.LogoURL == nil || *investmentTxn.LogoURL != logoURL {
		t.Fatalf("investment logo = %#v", investmentTxn.LogoURL)
	}
	if investmentTxn.PlaidCategory == nil || *investmentTxn.PlaidCategory != "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS" {
		t.Fatalf("investment plaid category = %#v", investmentTxn.PlaidCategory)
	}
	regularChecking, err := test.TransactionBySourceExternalID(ctx, fixture.store, transactions.TransactionSourcePlaid, "regular-checking")
	if err != nil || regularChecking == nil {
		t.Fatalf("regular checking transaction = %#v, %v", regularChecking, err)
	}
	regularInvest, err := test.TransactionBySourceExternalID(ctx, fixture.store, transactions.TransactionSourcePlaid, "regular-invest")
	if err != nil || regularInvest != nil {
		t.Fatalf("regular investment transaction = %#v, %v", regularInvest, err)
	}

	apis, addedPayloads := plaidSyncLogAPIs(t, fixture.store, fixture.itemID)
	if strings.Join(apis, ",") != "investments,transactions" {
		t.Fatalf("sync log apis = %#v", apis)
	}
	if !strings.Contains(addedPayloads[0], "itx") || !strings.Contains(addedPayloads[1], "regular-checking") {
		t.Fatalf("sync log added payloads = %#v", addedPayloads)
	}
}

func TestRunHonorsItemDueTime(t *testing.T) {
	tests := map[string]struct {
		nextSyncOffset time.Duration
		wantSync       bool
		failure        string
	}{
		"syncs immediately when item due": {nextSyncOffset: -time.Minute, wantSync: true, failure: "Run did not sync immediately"},
		"skips items before due time":     {nextSyncOffset: time.Hour, failure: "Run synced before persisted due time"},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			store := openPlaidSchedulerTestStore(t)
			itemID := seedPlaidItem(t, store, "item")

			now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
			setNextSyncAt(t, store, itemID, now.Add(tc.nextSyncOffset))
			synced := make(chan struct{}, 1)
			done := make(chan struct{})
			syncer := newTestSyncer(store, signalingClient{synced: synced}, withNow(func() time.Time { return now }))
			go func() {
				defer close(done)
				syncer.Run(ctx)
			}()

			if tc.wantSync {
				select {
				case <-synced:
				case <-time.After(time.Second):
					t.Fatal(tc.failure)
				}
				assertNextSyncAfter(t, store, itemID, now)
			} else {
				select {
				case <-synced:
					t.Fatal(tc.failure)
				case <-time.After(25 * time.Millisecond):
				}
			}
			cancel()
			<-done
		})
	}
}

type signalingClient struct {
	fakeClient
	synced chan struct{}
}

type investmentTransactionsClient struct {
	fakeClient
	startDate  string
	endDate    string
	accountIDs []string
}

func (c *investmentTransactionsClient) Accounts(ctx context.Context, accessToken string) ([]plaidapi.AccountBase, error) {
	return []plaidapi.AccountBase{
		test.AccountBase("checking", "Checking", "1111", "depository", "checking"),
		test.AccountBase("invest", "Brokerage", "2222", "investment", "brokerage"),
	}, nil
}

func (c *investmentTransactionsClient) InvestmentsTransactionsGet(
	ctx context.Context,
	accessToken string,
	startDate string,
	endDate string,
	accountIDs []string,
	count int32,
	offset int32,
) (plaidapi.InvestmentsTransactionsGetResponse, error) {
	c.startDate = startDate
	c.endDate = endDate
	c.accountIDs = append([]string{}, accountIDs...)
	security := plaidapi.NewSecurityWithDefaults()
	security.SetSecurityId("sec")
	security.SetName("Treasury ETF")
	security.SetTickerSymbol("SGOV")
	itx := plaidapi.NewInvestmentTransactionWithDefaults()
	itx.SetInvestmentTransactionId("itx")
	itx.SetAccountId("invest")
	itx.SetSecurityId("sec")
	itx.SetType(plaidapi.InvestmentTransactionType("buy"))
	itx.SetSubtype(plaidapi.InvestmentTransactionSubtype("buy"))
	itx.SetAmount(100)
	itx.SetDate("2026-06-18")
	itx.SetName("BUY")
	return plaidapi.InvestmentsTransactionsGetResponse{
		InvestmentTransactions:      []plaidapi.InvestmentTransaction{*itx},
		Securities:                  []plaidapi.Security{*security},
		TotalInvestmentTransactions: 1,
	}, nil
}

func (c *investmentTransactionsClient) Sync(ctx context.Context, accessToken, cursor string) (plaidapi.TransactionsSyncResponse, error) {
	checking := plaidTransaction("regular-checking", "checking", 12, "2026-06-18")
	investment := plaidTransaction("regular-invest", "invest", 13, "2026-06-18")
	removed := plaidapi.NewRemovedTransaction()
	removed.SetTransactionId("legacy-invest")
	return plaidapi.TransactionsSyncResponse{
		Added:      []plaidapi.Transaction{checking, investment},
		Removed:    []plaidapi.RemovedTransaction{*removed},
		NextCursor: "done",
		HasMore:    false,
	}, nil
}

func (c signalingClient) Sync(ctx context.Context, accessToken, cursor string) (plaidapi.TransactionsSyncResponse, error) {
	select {
	case c.synced <- struct{}{}:
	default:
	}
	return c.fakeClient.Sync(ctx, accessToken, cursor)
}

func setNextSyncAt(t *testing.T, store *transactionsTestStore, itemID int64, nextSyncAt time.Time) {
	t.Helper()
	must.NoErr(t, store.SetPlaidItemScheduleColumn(context.Background(), itemID, "next_sync_at", nextSyncAt))
}

func assertNextSyncAfter(t *testing.T, store *transactionsTestStore, itemID int64, after time.Time) {
	t.Helper()
	deadline := time.After(time.Second)
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		raw, err := store.PlaidItemNextSyncAtStr(context.Background(), itemID)
		must.NoErr(t, err)
		got, err := time.Parse(time.RFC3339, raw)
		must.NoErr(t, err)
		if got.After(after) {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("next_sync_at = %v, want after %v", got, after)
		case <-tick.C:
		}
	}
}

func plaidSyncLogAPIs(t *testing.T, store *transactionsTestStore, itemID int64) ([]string, []string) {
	t.Helper()
	rows, err := store.SQL().QueryContext(
		context.Background(),
		`SELECT api, added FROM plaid_sync_log WHERE item_id = ? ORDER BY id`,
		itemID,
	)
	must.NoErr(t, err)
	defer func() { _ = rows.Close() }()
	apis := []string{}
	addedPayloads := []string{}
	for rows.Next() {
		var api string
		var added string
		must.NoErr(t, rows.Scan(&api, &added))
		apis = append(apis, api)
		addedPayloads = append(addedPayloads, added)
	}
	must.NoErr(t, rows.Err())
	return apis, addedPayloads
}

func openPlaidSchedulerTestStore(t *testing.T) *transactionsTestStore {
	t.Helper()
	return openTransactionsTestStore(t, t.TempDir()+"/test.db")
}

type transactionsTestStore struct {
	*test.Store
	*transactionTestStore
	Accounts *accountsdb.Store
	Admin    *admindb.Store
}

type transactionTestStore struct{ *transactionsdb.Store }

func openTransactionsTestStore(t *testing.T, path string) *transactionsTestStore {
	t.Helper()
	base := test.OpenStoreAt(t, path, "Open() error = %v")
	return &transactionsTestStore{
		Store:                base,
		transactionTestStore: &transactionTestStore{Store: transactionsdb.New(base.Database())},
		Accounts:             accountsdb.New(base.Database()),
		Admin:                admindb.New(base.Database()),
	}
}

func (s *transactionsTestStore) OwnerByName(ctx context.Context, name string) (*model.Owner, error) {
	return test.OwnerByName(ctx, s.Accounts, name)
}

func (s *transactionsTestStore) Owners(ctx context.Context) ([]*model.Owner, error) {
	return s.Accounts.Owners(ctx)
}

func (s *transactionsTestStore) UpsertPlaidItem(ctx context.Context, item accounts.PlaidItemSecret) (int64, error) {
	return s.Accounts.UpsertPlaidItem(ctx, item)
}

func TestSyncItemByIDRejectsManualItem(t *testing.T) {
	ctx := context.Background()
	store := openTransactionsTestStore(t, ":memory:")
	syncer := newTestSyncer(store, fakeClient{})

	result := syncer.SyncItemByID(ctx, 999)
	if result == nil || result.Error == nil {
		t.Fatalf("expected manual item sync error, got %#v", result)
	}
}

func TestSyncDueItemsRecordsClientErrors(t *testing.T) {
	fixture := newSeededSyncFixture(t, errorClient{})
	result := fixture.syncer.SyncDueItems(context.Background())
	if len(result.Items) != 1 || result.Items[0].Error == nil {
		t.Fatalf("SyncDueItems() = %#v", result)
	}
}

func TestSyncDueItemsMarksItemLoginRequiredHealth(t *testing.T) {
	ctx := context.Background()
	fixture := newSeededSyncFixture(t, loginRequiredSyncClient{fakeClient{}})

	result := fixture.syncer.SyncDueItems(ctx)
	if len(result.Items) != 1 || result.Items[0].Error == nil {
		t.Fatalf("SyncDueItems() = %#v", result)
	}
	stored, err := fixture.store.Accounts.PlaidItem(ctx, fixture.itemID)
	if err != nil || stored.HealthState != model.PlaidItemHealthStateLinkUpdateRequired || stored.HealthErrorCode == nil || *stored.HealthErrorCode != "ITEM_LOGIN_REQUIRED" {
		t.Fatalf("stored item health = %#v, %v", stored, err)
	}
}

func TestSyncDueItemsMarksHealthyAfterSuccessfulSync(t *testing.T) {
	ctx := context.Background()
	fixture := newSeededSyncFixture(t, fakeClient{})
	code := "ITEM_LOGIN_REQUIRED"
	message := "login required"
	must.NoErr(t, fixture.store.SetPlaidItemHealth(ctx, fixture.itemID, model.PlaidItemHealthStateLinkUpdateRequired, &code, &message))

	result := fixture.syncer.SyncDueItems(ctx)
	if len(result.Items) != 1 || result.Items[0].Error != nil {
		t.Fatalf("SyncDueItems() = %#v", result)
	}
	stored, err := fixture.store.Accounts.PlaidItem(ctx, fixture.itemID)
	if err != nil || stored.HealthState != model.PlaidItemHealthStateHealthy || stored.HealthErrorCode != nil || stored.HealthErrorMessage != nil {
		t.Fatalf("stored item health = %#v, %v", stored, err)
	}
}

type loginRequiredSyncClient struct{ fakeClient }

func (c loginRequiredSyncClient) Sync(ctx context.Context, accessToken, cursor string) (plaidapi.TransactionsSyncResponse, error) {
	plaidErr := *plaidapi.NewPlaidError(plaidapi.PLAIDERRORTYPE_ITEM_ERROR, "ITEM_LOGIN_REQUIRED", "login required", plaidapi.NullableString{})
	return plaidapi.TransactionsSyncResponse{}, plaidapi.MakeGenericOpenAPIError(nil, "login required", plaidErr)
}

type errorClient struct{ test.PlaidClientStub }

func (errorClient) Accounts(context.Context, string) ([]plaidapi.AccountBase, error) {
	return nil, errFake
}

func TestSyncRecurringStreams(t *testing.T) {
	tests := map[string]bool{
		"with Plaid error": false,
		"skips early":      true,
	}
	for name, syncBeforeAccount := range tests {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			fixture := newSeededSyncFixture(t, fakeClient{})
			alexOwner, _ := fixture.store.OwnerByName(ctx, "alex")
			if syncBeforeAccount {
				fixture.syncer.RecurringSyncAll(ctx)
			}

			mask := "0000"
			test.MustUpsertAccount(t, fixture.store.Accounts, "acc", &model.Account{Connection: &model.Connection{SourceTable: "plaid_items", SourceID: fixture.itemID}, Owner: alexOwner, Name: "Card", Type: model.AccountTypeCredit, Mask: &mask})
			fixture.syncer.RecurringSyncAll(ctx)
		})
	}
}

func TestSyncRecurringStreamsSkipsManualAndClosedAccounts(t *testing.T) {
	ctx := context.Background()
	fixture := newSeededSyncFixture(t, fakeClient{}, withLog(test.Logger))
	alexOwner, _ := fixture.store.OwnerByName(ctx, "alex")

	mask := "0000"
	// manual account — should be filtered out
	test.MustUpsertAccount(t, fixture.store.Accounts, "manual-abc", &model.Account{Connection: &model.Connection{SourceTable: "plaid_items", SourceID: fixture.itemID}, Owner: alexOwner, Name: "Closed Card", Type: model.AccountTypeCredit, Mask: &mask, Manual: true, Closed: true})
	// closed non-manual account — should also be filtered out
	test.MustUpsertAccount(t, fixture.store.Accounts, "closed-real", &model.Account{Connection: &model.Connection{SourceTable: "plaid_items", SourceID: fixture.itemID}, Owner: alexOwner, Name: "Closed Real", Type: model.AccountTypeCredit, Mask: &mask, Closed: true})

	// fakeClient would panic if it ever reached the Plaid API call; early return is the expected path.
	fixture.syncer.RecurringSyncAll(ctx)
}

var errFake = errors.New("fake")

func seedPlaidItem(t *testing.T, store *transactionsTestStore, itemID string) int64 {
	t.Helper()
	owner, rowID := test.SeedPlaidItem(t, store.Accounts, store.Admin, itemID, "alex")
	connectionName := "Institution"
	test.MustCreateConnection(t, store.Accounts, rowID, &connectionName, owner.ID.Int64())
	return rowID
}
