package txnplaid

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/clients"
	"tallyo/internal/database"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"
	transactionsdb "tallyo/internal/transactions/db"
	u "tallyo/internal/utils"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
)

type PlaidSyncStore interface {
	PlaidItemsDueForSync(ctx context.Context, now time.Time) ([]accounts.PlaidItemSecret, error)
	PlaidItemsDueForRecurringSync(ctx context.Context, now time.Time) ([]accounts.PlaidItemSecret, error)
	SetItemRecurringSynced(ctx context.Context, itemID int64, nextRecurringSyncAt time.Time) error
	SetItemTransactionsSynced(ctx context.Context, itemID int64, nextSyncAt time.Time) error
	PlaidItemSecret(ctx context.Context, id int64) (*accounts.PlaidItemSecret, error)
	SetPlaidItemHealthy(ctx context.Context, itemID int64) error
	SetPlaidItemHealth(
		ctx context.Context,
		itemID int64,
		state model.PlaidItemHealthState,
		code, message *string,
	) error
	SyncCursor(ctx context.Context, plaidItemID int64) (string, error)
	SetSyncCursor(ctx context.Context, plaidItemID int64, cursor string, nextSyncAt time.Time) error
	LogSyncBatch(ctx context.Context, log transactions.SyncBatchLog) error
}

type Adapter struct {
	transactions.BaseAdapter
	plaid   PlaidSyncStore
	clients clients.PlaidClientFactory
	now     func() time.Time
}

type itemSync struct {
	adapter *Adapter
	ctx     context.Context
	client  clients.PlaidClient
	item    accounts.PlaidItemSecret
	sink    transactions.PersistSink
	drafts  []transactions.AccountDraft
	connID  int64
	hidden  map[string]bool
}

func New(
	db *database.DB,
	clients clients.PlaidClientFactory,
	now func() time.Time,
	log *slog.Logger,
) *Adapter {
	accountStore := accountsdb.New(db)
	transactionStore := transactionsdb.New(db)
	return &Adapter{
		BaseAdapter: transactions.BaseAdapter{Reads: accountStore, Log: log},
		plaid:       transactionStore,
		clients:     clients,
		now:         now,
	}
}

func (a *Adapter) Handles(provider accounts.SourceTable) bool {
	return provider == accounts.SourceTablePlaidItem
}

func (a *Adapter) SyncDue(ctx context.Context, sink transactions.PersistSink) transactions.SyncReport {
	items, err := a.plaid.PlaidItemsDueForSync(ctx, a.utcNow())
	if err != nil {
		return a.generalErrorReport(err)
	}
	syncItem := func(item accounts.PlaidItemSecret) transactions.ItemReport {
		return a.syncItem(ctx, item, sink)
	}
	return transactions.SyncReport{Items: u.Map(items, syncItem)}
}

func (a *Adapter) SyncConnectionInto(ctx context.Context, itemID int64, sink transactions.PersistSink) transactions.ItemReport {
	item, err := a.plaid.PlaidItemSecret(ctx, itemID)
	if err != nil {
		return transactions.ItemReport{Err: err}
	}
	if item == nil {
		return transactions.ItemReport{Err: fmt.Errorf("plaid item %d not found", itemID)}
	}
	return a.syncItem(ctx, *item, sink)
}

func (a *Adapter) syncItem(
	ctx context.Context,
	item accounts.PlaidItemSecret,
	sink transactions.PersistSink,
) transactions.ItemReport {
	client, err := a.clients.ClientForCredential(ctx, item.CredentialID)
	if err != nil {
		return transactions.ItemReport{Err: err}
	}
	conn, err := a.connectionForItem(ctx, item.ID)
	if err != nil {
		return transactions.ItemReport{Err: err}
	}
	drafts, err := a.accountDrafts(ctx, client, item, conn)
	if err != nil {
		a.recordItemSyncError(ctx, item.ID, err)
		return transactions.ItemReport{Err: fmt.Errorf("fetch accounts %d: %w", item.ID, err)}
	}

	sync := itemSync{
		adapter: a,
		ctx:     ctx,
		client:  client,
		item:    item,
		sink:    sink,
		drafts:  drafts,
		connID:  conn.ID.Int64(),
	}
	investmentAccountIDs := investmentAccountIDsForSync(item, drafts)
	if !hasTransactionSyncableAccount(drafts) {
		return (&sync).syncCursorlessItem(investmentAccountIDs)
	}
	if len(investmentAccountIDs) == 0 {
		return (&sync).syncPlainItem()
	}
	return (&sync).syncMixedItem(investmentAccountIDs)
}

// finalizeCursorlessSync advances next_sync_at without requiring a Plaid
// sync cursor, for items whose accounts can't use /transactions/sync.
func (s *itemSync) finalizeCursorlessSync(
	counts transactions.ItemCounts,
) transactions.ItemReport {
	a := s.adapter
	item := s.item
	nextSyncAt, err := u.NextAfter(item.SyncCron, a.utcNow())
	if err != nil {
		return transactions.ItemReport{Counts: counts, Err: err}
	}
	if err := a.plaid.SetItemTransactionsSynced(s.ctx, item.ID, nextSyncAt); err != nil {
		return transactions.ItemReport{Counts: counts, Err: err}
	}
	if err := a.plaid.SetPlaidItemHealthy(s.ctx, item.ID); err != nil {
		return transactions.ItemReport{Counts: counts, Err: err}
	}
	return transactions.ItemReport{Counts: counts}
}

func (s *itemSync) finalizeCursorSync(persist transactions.PersistResult, nextCursor string) transactions.ItemReport {
	a := s.adapter
	item := s.item
	if persist.Err != nil {
		a.logPersistError(item.ID, persist.Err)
		return transactions.ItemReport(persist)
	}
	if nextCursor != "" {
		nextSyncAt, err := u.NextAfter(item.SyncCron, a.utcNow())
		if err != nil {
			return transactions.ItemReport{Counts: persist.Counts, Err: err}
		}
		if err := a.plaid.SetSyncCursor(s.ctx, item.ID, nextCursor, nextSyncAt); err != nil {
			return transactions.ItemReport{Counts: persist.Counts, Err: err}
		}
	}
	if err := a.plaid.SetPlaidItemHealthy(s.ctx, item.ID); err != nil {
		return transactions.ItemReport{Counts: persist.Counts, Err: err}
	}
	return transactions.ItemReport{Counts: persist.Counts}
}

func (s *itemSync) hiddenAccounts() (map[string]bool, error) {
	if s.hidden != nil {
		return s.hidden, nil
	}
	hidden, err := s.adapter.Reads.HiddenAccountIDsByConnection(s.ctx, s.connID)
	if err != nil {
		return nil, fmt.Errorf("load hidden accounts: %w", err)
	}
	if hidden == nil {
		hidden = map[string]bool{}
	}
	s.hidden = hidden
	return hidden, nil
}

func (a *Adapter) accountDrafts(
	ctx context.Context,
	client clients.PlaidClient,
	item accounts.PlaidItemSecret,
	conn *model.Connection,
) ([]transactions.AccountDraft, error) {
	plaidAccounts, err := client.Accounts(ctx, item.AccessToken)
	if err != nil {
		return nil, err
	}
	toAccountDraft := func(account plaidapi.AccountBase) transactions.AccountDraft {
		fields := accounts.FieldsFromPlaidAccount(account)
		return transactions.AccountDraft{
			ID:           fields.ID,
			ConnectionID: conn.ID.Int64(),
			OwnerID:      item.OwnerID,
			Name:         fields.Name,
			Type:         fields.Type,
			Subtype:      fields.Subtype,
			Mask:         fields.Mask,
		}
	}
	return u.Map(plaidAccounts, toAccountDraft), nil
}

func (a *Adapter) connectionForItem(ctx context.Context, itemID int64) (*model.Connection, error) {
	conn, err := a.Reads.ConnectionByPlaidItemID(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if conn == nil {
		return nil, fmt.Errorf("no connection for plaid item %d", itemID)
	}
	return conn, nil
}

func (a *Adapter) utcNow() time.Time {
	return a.now().UTC()
}

func (a *Adapter) logPersistError(itemID int64, err error) {
	if err == nil {
		return
	}
	a.Log.Warn("persist batch failed; cursor not advanced, will retry next sync", "item_id", itemID, "error", err)
}
