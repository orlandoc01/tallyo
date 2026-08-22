package txnsimplefin

import (
	"context"
	"errors"
	"testing"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/clients"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/transactions"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/nooplog"
	testutil "tallyo/internal/utils/test"
)

func TestTransactionFromSimpleFin(t *testing.T) {
	txn := clients.SimpleFinTransaction{
		ID:           "tx-1",
		TransactedAt: 1_700_000_000,
		Posted:       0,
		Amount:       "-12.34",
		Description:  "APPLE.COM/BILL",
		Payee:        "Apple",
	}
	draft, err := transactionFromSimpleFin("acc", txn, true)
	must.NoErr(t, err)
	if draft.Amount != 12.34 || draft.Source != "simplefin" || !draft.Pending || !draft.HiddenByAccount {
		t.Fatalf("draft = %#v", draft)
	}
	if draft.MerchantName == nil || *draft.MerchantName != "Apple" {
		t.Fatalf("merchant = %#v", draft.MerchantName)
	}
	if draft.OriginalName == nil || *draft.OriginalName != "APPLE.COM/BILL" {
		t.Fatalf("original = %#v", draft.OriginalName)
	}
	if draft.PostedDatetime != draft.Datetime {
		t.Fatalf("posted datetime = %q, datetime = %q", draft.PostedDatetime, draft.Datetime)
	}
	if draft.RawProviderJSON == nil || *draft.RawProviderJSON == "" {
		t.Fatalf("raw json = %#v", draft.RawProviderJSON)
	}
}

func TestSyncTokenPersistsSimpleFinData(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)
	last := now.Add(-24 * time.Hour)
	store := &fakeSimpleFinStore{
		pendingIDs: []string{"stale-pending", "tx-1"},
	}
	accountStore := &fakeAccountStore{
		hidden:            map[string]bool{"acc-1": true},
		connectionID:      map[string]int64{"conn-1": 1},
		hiddenLookupCalls: map[int64]int{},
	}
	client := testutil.SimpleFinClientStub{ClaimErr: errors.New("not used"), Accounts: clients.SimpleFinAccountSet{
		Connections: []clients.SimpleFinConnection{{ConnID: "conn-1", Name: "Bank", OrgURL: "https://bank.example", SfinURL: "https://bridge.example/simplefin"}},
		Accounts: []clients.SimpleFinAccount{{
			ID:      "acc-1",
			ConnID:  "conn-1",
			Name:    "Mystery Account",
			Extra:   map[string]any{"kind": "test"},
			Balance: "0",
			Transactions: []clients.SimpleFinTransaction{{
				ID:           "tx-1",
				TransactedAt: now.Unix(),
				Posted:       now.Unix(),
				Amount:       "-4.25",
				Payee:        "Coffee",
				Description:  "COFFEE SHOP",
			}},
		}},
	}}
	adapter := simpleFinTestAdapter(now, store, accountStore, client)
	sink := &recordingSink{}

	report := adapter.syncToken(ctx, simpleFinTestToken(last), sink)
	if report.Err != nil {
		t.Fatalf("syncToken() error = %v", report.Err)
	}
	if report.Counts.AccountsUpserted != 1 || report.Counts.Added != 1 || report.Counts.Removed != 1 {
		t.Fatalf("counts = %#v", report.Counts)
	}
	if len(accountStore.upsertedConnections) != 1 || accountStore.upsertedConnections[0].ExternalID != "conn-1" {
		t.Fatalf("upserted connections = %#v", accountStore.upsertedConnections)
	}
	if len(sink.accounts) != 1 || sink.accounts[0].ConnectionID != 1 || sink.accounts[0].OwnerID != 1 || !sink.accounts[0].NeedsReview {
		t.Fatalf("accounts = %#v", sink.accounts)
	}
	if len(sink.upserts) != 1 || sink.upserts[0].Amount != 4.25 || sink.upserts[0].Source != "simplefin" || !sink.upserts[0].HiddenByAccount {
		t.Fatalf("upserts = %#v", sink.upserts)
	}
	if len(sink.removals) != 1 || sink.removals[0] != "stale-pending" {
		t.Fatalf("removals = %#v", sink.removals)
	}
	if accountStore.syncedTokenID != 7 || accountStore.nextSyncAt.IsZero() {
		t.Fatalf("synced token = %d next=%v", accountStore.syncedTokenID, accountStore.nextSyncAt)
	}
	if len(store.logs) != 1 || store.logs[0].AccessTokenID != 7 || store.logs[0].StartDate == nil {
		t.Fatalf("logs = %#v", store.logs)
	}
}

func TestSyncTokenPartialResponseSkipsPendingRemovalAndSchedule(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)
	last := now.Add(-24 * time.Hour)
	store := &fakeSimpleFinStore{pendingIDs: []string{"healthy-pending", "failed-pending"}}
	accountStore := &fakeAccountStore{
		hidden:             map[string]bool{},
		connectionID:       map[string]int64{"healthy-conn": 1},
		connIDByExternalID: map[string]int64{"failed-conn": 2},
		hiddenLookupCalls:  map[int64]int{},
	}
	client := testutil.SimpleFinClientStub{ClaimErr: errors.New("not used"), Accounts: partialSimpleFinAccountSet(now)}
	adapter := simpleFinTestAdapter(now, store, accountStore, client)
	sink := &recordingSink{}

	report := adapter.syncToken(ctx, simpleFinTestToken(last), sink)
	if report.Err != nil {
		t.Fatalf("syncToken() error = %v", report.Err)
	}
	if len(sink.upserts) != 1 || sink.upserts[0].ExternalID != "healthy-tx" {
		t.Fatalf("upserts = %#v", sink.upserts)
	}
	if len(sink.removals) != 0 || accountStore.syncedTokenID != 0 || !accountStore.nextSyncAt.IsZero() {
		t.Fatalf("removals=%#v synced=%d next=%v", sink.removals, accountStore.syncedTokenID, accountStore.nextSyncAt)
	}
	if len(accountStore.healthUpdates) != 2 || accountStore.healthUpdates[0].state != "HEALTHY" || accountStore.healthUpdates[1].connID != 2 || accountStore.healthUpdates[1].state != "SYNC_ERROR" {
		t.Fatalf("health updates = %#v", accountStore.healthUpdates)
	}
}

func TestSyncTokenCachesHiddenAccountsByConnection(t *testing.T) {
	now := time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)
	accountStore := &fakeAccountStore{
		hidden:            map[string]bool{},
		connectionID:      map[string]int64{"conn-1": 1, "conn-2": 2},
		hiddenLookupCalls: map[int64]int{},
	}
	client := testutil.SimpleFinClientStub{ClaimErr: errors.New("not used"), Accounts: clients.SimpleFinAccountSet{
		Connections: []clients.SimpleFinConnection{{ConnID: "conn-1"}, {ConnID: "conn-2"}},
		Accounts: []clients.SimpleFinAccount{
			{ID: "acc-1", ConnID: "conn-1"},
			{ID: "acc-2", ConnID: "conn-1"},
			{ID: "acc-3", ConnID: "conn-2"},
		},
	}}
	adapter := simpleFinTestAdapter(now, &fakeSimpleFinStore{}, accountStore, client)

	report := adapter.syncToken(context.Background(), simpleFinTestToken(now.Add(-24*time.Hour)), &recordingSink{})
	if report.Err != nil {
		t.Fatalf("syncToken() error = %v", report.Err)
	}
	if accountStore.hiddenLookupCalls[1] != 1 || accountStore.hiddenLookupCalls[2] != 1 {
		t.Fatalf("hidden lookup calls = %#v, want one per connection", accountStore.hiddenLookupCalls)
	}
}

func simpleFinTestAdapter(
	now time.Time,
	store *fakeSimpleFinStore,
	accountStore *fakeAccountStore,
	client clients.SimpleFinClient,
) *Adapter {
	return &Adapter{store: store, accounts: accountStore, client: client, now: func() time.Time { return now }, log: nooplog.Logger}
}

func partialSimpleFinAccountSet(now time.Time) clients.SimpleFinAccountSet {
	return clients.SimpleFinAccountSet{
		Connections: []clients.SimpleFinConnection{{ConnID: "healthy-conn", Name: "Bank", OrgURL: "https://bank.example", SfinURL: "https://bridge.example/simplefin"}},
		Accounts: []clients.SimpleFinAccount{{
			ID: "healthy-account", ConnID: "healthy-conn", Name: "Checking", Balance: "0",
			Transactions: []clients.SimpleFinTransaction{{ID: "healthy-tx", TransactedAt: now.Unix(), Posted: now.Unix(), Amount: "-9.99", Payee: "Grocer"}},
		}},
		Errors: []clients.SimpleFinError{{ConnID: "failed-conn", Message: "temporarily unavailable"}},
	}
}

func simpleFinTestToken(last time.Time) accounts.SimpleFinAccessTokenSecret {
	return accounts.SimpleFinAccessTokenSecret{
		ID:           7,
		AccessURL:    "https://user:pass@bridge.example/simplefin",
		OwnerID:      1,
		SyncCron:     "0 6,18 * * *",
		LastSyncedAt: &last,
	}
}

type fakeAccountStore struct {
	hidden              map[string]bool
	connectionID        map[string]int64
	connIDByExternalID  map[string]int64
	hiddenLookupCalls   map[int64]int
	upsertedConnections []accounts.UpsertSimpleFinConnectionParams
	healthUpdates       []fakeSimpleFinHealthUpdate
	syncedTokenID       int64
	nextSyncAt          time.Time
}

type fakeSimpleFinHealthUpdate struct {
	connID int64
	state  string
}

func (f *fakeAccountStore) HiddenAccountIDsByConnection(ctx context.Context, connectionID int64) (map[string]bool, error) {
	f.hiddenLookupCalls[connectionID]++
	return f.hidden, nil
}

func (f *fakeAccountStore) SimpleFinTokensDueForSync(ctx context.Context, now time.Time) ([]accounts.SimpleFinAccessTokenSecret, error) {
	return nil, nil
}

func (f *fakeAccountStore) SimpleFinTokenSecretByConnID(ctx context.Context, connID int64) (*accounts.SimpleFinAccessTokenSecret, error) {
	return nil, nil
}

func (f *fakeAccountStore) LinkSimpleFinConnection(ctx context.Context, conn accounts.UpsertSimpleFinConnectionParams) (int64, int64, error) {
	f.upsertedConnections = append(f.upsertedConnections, conn)
	return 1, f.connectionID[conn.ExternalID], nil
}

func (f *fakeAccountStore) SimpleFinConnectionIDsByExternalID(ctx context.Context, tokenID int64, externalIDs []string) (map[string]int64, error) {
	ids := map[string]int64{}
	for _, externalID := range externalIDs {
		if id, ok := f.connIDByExternalID[externalID]; ok {
			ids[externalID] = id
		}
	}
	return ids, nil
}

func (f *fakeAccountStore) SetSimpleFinConnectionHealth(ctx context.Context, connID int64, state string, errMsg *string, lastSyncedAt time.Time) error {
	f.healthUpdates = append(f.healthUpdates, fakeSimpleFinHealthUpdate{connID: connID, state: state})
	return nil
}

func (f *fakeAccountStore) SetSimpleFinTokenSynced(ctx context.Context, id int64, lastSyncedAt time.Time, nextSyncAt time.Time) error {
	f.syncedTokenID = id
	f.nextSyncAt = nextSyncAt
	return nil
}

type fakeSimpleFinStore struct {
	pendingIDs []string
	logs       []dbgen.LogSimpleFinSyncBatchParams
}

func (f *fakeSimpleFinStore) LogSimpleFinSyncBatch(ctx context.Context, params dbgen.LogSimpleFinSyncBatchParams) error {
	f.logs = append(f.logs, params)
	return nil
}

func (f *fakeSimpleFinStore) PendingSimpleFinTransactionIDs(ctx context.Context, tokenID int64) ([]string, error) {
	return f.pendingIDs, nil
}

type recordingSink struct {
	accounts []transactions.AccountDraft
	upserts  []transactions.SyncedTransaction
	removals []string
}

func (s *recordingSink) Open(ctx context.Context) (chan<- transactions.PersistEvent, <-chan transactions.PersistResult) {
	events := make(chan transactions.PersistEvent)
	results := make(chan transactions.PersistResult, 1)
	go func() {
		var counts transactions.ItemCounts
		for ev := range events {
			switch {
			case ev.AccountUpsert != nil:
				s.accounts = append(s.accounts, *ev.AccountUpsert)
				counts.AccountsUpserted++
			case ev.Upsert != nil:
				s.upserts = append(s.upserts, *ev.Upsert)
				counts.Added++
			case ev.Removal != nil:
				s.removals = append(s.removals, ev.Removal.ID)
				counts.Removed++
			}
		}
		results <- transactions.PersistResult{Counts: counts}
	}()
	return events, results
}
