package txnplaid

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"
	transactionsdb "tallyo/internal/transactions/db"
	testutil "tallyo/internal/utils/test"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"tallyo/internal/utils/must"
)

func TestSyncItemPersistsInvestmentAccountBeforeTransactionIntegration(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStoreAt(t, ":memory:", "Open(): %v")

	accountsStore := accountsdb.New(store.Database())
	adminStore := admindb.New(store.Database())
	txStore := transactionsdb.New(store.Database())
	owner := testutil.MustCreateOwner(t, accountsStore, model.CreateOwnerInput{Name: "tester"})
	credential, err := adminStore.CreatePlaidCredential(ctx, model.CreatePlaidCredentialInput{
		ClientID:    "client-id",
		Secret:      "secret",
		Environment: model.PlaidEnvironmentSandbox,
	})
	must.NoErr(t, err)
	item := accounts.PlaidItemSecret{
		ExternalID:         "item-fk",
		CredentialID:       credential.ID,
		AccessToken:        "access-token",
		OwnerID:            owner.ID.Int64(),
		OwnerName:          owner.Name,
		InvestmentsEnabled: true,
	}
	itemID, err := accountsStore.UpsertPlaidItem(ctx, item)
	must.NoErr(t, err)
	item.ID = itemID
	connectionName := "Institution"
	testutil.MustCreateConnection(t, accountsStore, item.ID, &connectionName, owner.ID.Int64())

	client := customAccountsClient(
		[]plaidapi.AccountBase{plaidAccount("acc-1", "Brokerage", "investment")},
		investmentTransactionsResponse(),
		nil,
	)
	adapter := New(
		store.Database(),
		testutil.StaticClientFactory{Client: client},
		func() time.Time { return time.Date(2026, 6, 20, 12, 0, 0, 0, time.UTC) },
		testutil.Logger,
	)
	persister := &transactions.Persister{
		Store:          txStore,
		WithLLMStaging: func(upsert func(bool) error) error { return upsert(false) },
	}

	report := adapter.SyncConnectionInto(ctx, item.ID, persister)
	if report.Err != nil {
		t.Fatalf("SyncConnectionInto(): %v", report.Err)
	}
	if report.Counts.AccountsUpserted != 1 || report.Counts.Added != 1 {
		t.Fatalf("counts = %#v", report.Counts)
	}
	accountID, err := testutil.AccountIDByExternalID(ctx, txStore.SQL(), "acc-1")
	must.NoErr(t, err)
	account, err := accountsStore.AccountByID(ctx, accountID)
	must.NoErr(t, err)
	if account.Name != "Brokerage" || account.Type != model.AccountTypeInvestment {
		t.Fatalf("account = %#v", account)
	}
	tx := testutil.MustTransactionBySourceExternalID(t, txStore, transactions.TransactionSourcePlaid, "itx-1", "Transaction(): %v")
	if tx == nil || tx.Account.ID != account.ID {
		t.Fatalf("transaction = %#v", tx)
	}
}
