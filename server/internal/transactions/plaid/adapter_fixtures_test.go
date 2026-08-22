package txnplaid

import (
	"context"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"
	testutil "tallyo/internal/utils/test"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
)

func newHandshakeAdapter(store *handshakeStore) *Adapter {
	return &Adapter{
		BaseAdapter: transactions.BaseAdapter{Reads: store, Log: testutil.Logger},
		plaid:       store,
		clients:     testutil.StaticClientFactory{Client: handshakeClient()},
		now:         func() time.Time { return time.Date(2026, 6, 20, 12, 0, 0, 0, time.UTC) },
	}
}

func newHandshakeTest() (*handshakeStore, *Adapter) {
	store := newHandshakeStore()
	return store, newHandshakeAdapter(store)
}

type handshakeSink struct {
	opened bool
	result transactions.PersistResult
	events []transactions.PersistEvent
}

func (s *handshakeSink) Open(ctx context.Context) (chan<- transactions.PersistEvent, <-chan transactions.PersistResult) {
	s.opened = true
	events := make(chan transactions.PersistEvent)
	result := make(chan transactions.PersistResult, 1)
	go func() {
		for event := range events {
			s.events = append(s.events, event)
		}
		result <- s.result
	}()
	return events, result
}

type handshakeStore struct {
	item            accounts.PlaidItemSecret
	connection      *model.Connection
	cursor          string
	nextSyncAt      time.Time
	nextRecurringAt time.Time
	healthy         bool
	healthTouched   bool
	healthState     model.PlaidItemHealthState
	healthCode      *string
}

func newHandshakeStore() *handshakeStore {
	connection := &model.Connection{ID: model.New(model.GlobalIDConnection, 1), SourceTable: "plaid_items", SourceID: 1}
	return &handshakeStore{
		item: accounts.PlaidItemSecret{
			ID:                1,
			ExternalID:        "item-1",
			CredentialID:      1,
			AccessToken:       "access-token",
			OwnerID:           1,
			OwnerName:         "Owner",
			SyncCron:          "0 * * * *",
			RecurringSyncCron: "0 * * * *",
		},
		connection: connection,
	}
}

func (s *handshakeStore) PlaidItemsDueForSync(ctx context.Context, now time.Time) ([]accounts.PlaidItemSecret, error) {
	return []accounts.PlaidItemSecret{s.item}, nil
}

func (s *handshakeStore) PlaidItemsDueForRecurringSync(ctx context.Context, now time.Time) ([]accounts.PlaidItemSecret, error) {
	return []accounts.PlaidItemSecret{s.item}, nil
}

func (s *handshakeStore) SetItemRecurringSynced(ctx context.Context, itemID int64, next time.Time) error {
	s.nextRecurringAt = next
	return nil
}

func (s *handshakeStore) SetItemTransactionsSynced(ctx context.Context, itemID int64, next time.Time) error {
	s.nextSyncAt = next
	return nil
}

func (s *handshakeStore) PlaidItemSecret(ctx context.Context, id int64) (*accounts.PlaidItemSecret, error) {
	if id != s.item.ID {
		return nil, nil
	}
	return &s.item, nil
}

func (s *handshakeStore) SetPlaidItemHealthy(ctx context.Context, itemID int64) error {
	s.healthy = true
	return nil
}

func (s *handshakeStore) SetPlaidItemHealth(
	ctx context.Context,
	itemID int64,
	state model.PlaidItemHealthState,
	code, message *string,
) error {
	s.healthTouched = true
	s.healthState = state
	s.healthCode = code
	return nil
}

func (s *handshakeStore) SyncCursor(ctx context.Context, plaidItemID int64) (string, error) {
	return "", nil
}

func (s *handshakeStore) SetSyncCursor(ctx context.Context, plaidItemID int64, cursor string, nextSyncAt time.Time) error {
	s.cursor = cursor
	s.nextSyncAt = nextSyncAt
	return nil
}

func (s *handshakeStore) LogSyncBatch(ctx context.Context, log transactions.SyncBatchLog) error {
	return nil
}

func (s *handshakeStore) SyncableAccountExternalIDsByItem(ctx context.Context, itemID int64) ([]string, error) {
	return []string{"plaid-checking-id"}, nil
}

func (s *handshakeStore) HiddenAccountIDsByConnection(ctx context.Context, connectionID int64) (map[string]bool, error) {
	return map[string]bool{}, nil
}

func (s *handshakeStore) ConnectionByPlaidItemID(ctx context.Context, plaidItemID int64) (*model.Connection, error) {
	return s.connection, nil
}

func handshakeClient() testutil.PlaidClientStub {
	return testutil.PlaidClientStub{
		AccountsFn: func(context.Context, string) ([]plaidapi.AccountBase, error) {
			return []plaidapi.AccountBase{testutil.AccountBase("acc-1", "Checking", "", "depository", "checking")}, nil
		},
		SyncFn:                     handshakeSync(nil),
		TransactionsRecurringGetFn: recurringSync(plaidapi.TransactionsRecurringGetResponse{}, nil, nil),
	}
}

func handshakeSync(syncErr error) func(context.Context, string, string) (plaidapi.TransactionsSyncResponse, error) {
	return func(context.Context, string, string) (plaidapi.TransactionsSyncResponse, error) {
		if syncErr != nil {
			return plaidapi.TransactionsSyncResponse{}, syncErr
		}

		tx := plaidapi.NewTransactionWithDefaults()
		tx.SetTransactionId("tx-1")
		tx.SetAccountId("acc-1")
		tx.SetAmount(10)
		tx.SetDate("2026-06-18")
		tx.SetName("Merchant")
		return plaidapi.TransactionsSyncResponse{
			Added:      []plaidapi.Transaction{*tx},
			NextCursor: "cursor-next",
			HasMore:    false,
		}, nil
	}
}

func recurringSync(
	resp plaidapi.TransactionsRecurringGetResponse,
	recurringErr error,
	accountIDs *[]string,
) func(context.Context, string, []string) (plaidapi.TransactionsRecurringGetResponse, error) {
	return func(_ context.Context, _ string, ids []string) (plaidapi.TransactionsRecurringGetResponse, error) {
		if accountIDs != nil {
			*accountIDs = ids
		}
		if recurringErr != nil {
			return plaidapi.TransactionsRecurringGetResponse{}, recurringErr
		}
		return resp, nil
	}
}

func recurringClient(
	resp plaidapi.TransactionsRecurringGetResponse,
	recurringErr error,
	accountIDs *[]string,
) testutil.PlaidClientStub {
	client := handshakeClient()
	client.TransactionsRecurringGetFn = recurringSync(resp, recurringErr, accountIDs)
	return client
}

func customAccountsClient(
	accounts []plaidapi.AccountBase,
	investmentsResp plaidapi.InvestmentsTransactionsGetResponse,
	syncCalls *int,
) testutil.PlaidClientStub {
	client := handshakeClient()
	client.AccountsFn = func(context.Context, string) ([]plaidapi.AccountBase, error) {
		return accounts, nil
	}
	client.InvestmentsTransactionsGetFn = investmentTransactions(investmentsResp)
	client.SyncFn = func(ctx context.Context, accessToken, cursor string) (plaidapi.TransactionsSyncResponse, error) {
		if syncCalls != nil {
			*syncCalls++
		}
		return handshakeSync(nil)(ctx, accessToken, cursor)
	}
	return client
}

func investmentStreamClient(resp plaidapi.InvestmentsTransactionsGetResponse) testutil.PlaidClientStub {
	return testutil.PlaidClientStub{InvestmentsTransactionsGetFn: investmentTransactions(resp)}
}

func investmentTransactions(
	resp plaidapi.InvestmentsTransactionsGetResponse,
) func(context.Context, string, string, string, []string, int32, int32) (plaidapi.InvestmentsTransactionsGetResponse, error) {
	return func(
		context.Context,
		string,
		string,
		string,
		[]string,
		int32,
		int32,
	) (plaidapi.InvestmentsTransactionsGetResponse, error) {
		return resp, nil
	}
}

func plaidAccount(id, name, accountType string) plaidapi.AccountBase {
	return testutil.AccountBase(id, name, "", accountType, accountType)
}

func recurringResponse() plaidapi.TransactionsRecurringGetResponse {
	avgAmount := plaidapi.NewTransactionStreamAmount()
	avgAmount.SetAmount(12.34)
	lastAmount := plaidapi.NewTransactionStreamAmount()
	lastAmount.SetAmount(12.34)
	stream := plaidapi.NewTransactionStream(
		"acc-1",
		"stream-1",
		[]string{"tx-1"},
		"Netflix",
		"Netflix",
		plaidapi.NullableString{},
		"2026-01-01",
		"2026-06-01",
		plaidapi.RecurringTransactionFrequency("MONTHLY"),
		[]string{"tx-1"},
		*avgAmount,
		*lastAmount,
		true,
		plaidapi.TransactionStreamStatus("MATURE"),
		false,
	)
	return plaidapi.TransactionsRecurringGetResponse{OutflowStreams: []plaidapi.TransactionStream{*stream}}
}

func investmentTransactionsResponse() plaidapi.InvestmentsTransactionsGetResponse {
	security := plaidapi.NewSecurityWithDefaults()
	security.SetSecurityId("sec-1")
	security.SetName("Treasury ETF")
	security.SetTickerSymbol("TBIL")
	itx := plaidapi.NewInvestmentTransactionWithDefaults()
	itx.SetInvestmentTransactionId("itx-1")
	itx.SetAccountId("acc-1")
	itx.SetSecurityId("sec-1")
	itx.SetType(plaidapi.InvestmentTransactionType("buy"))
	itx.SetSubtype(plaidapi.InvestmentTransactionSubtype("buy"))
	itx.SetAmount(100)
	itx.SetDate("2026-06-18")
	itx.SetName("BUY")
	return plaidapi.InvestmentsTransactionsGetResponse{
		InvestmentTransactions:      []plaidapi.InvestmentTransaction{*itx},
		Securities:                  []plaidapi.Security{*security},
		TotalInvestmentTransactions: 1,
	}
}
