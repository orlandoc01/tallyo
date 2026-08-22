package txnsimplefin

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/clients"
	"tallyo/internal/database"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/transactions"
	transactionsdb "tallyo/internal/transactions/db"
	u "tallyo/internal/utils"

	"github.com/samber/lo"
)

// Store covers the transaction-domain-owned SimpleFIN operations: per-batch
// sync logging and pending-transaction resolution. Token/connection
// lifecycle lives on AccountStore instead (accounts/db owns it).
type Store interface {
	LogSimpleFinSyncBatch(ctx context.Context, params dbgen.LogSimpleFinSyncBatchParams) error
	PendingSimpleFinTransactionIDs(ctx context.Context, tokenID int64) ([]string, error)
}

type AccountStore interface {
	HiddenAccountIDsByConnection(ctx context.Context, connectionID int64) (map[string]bool, error)
	SimpleFinTokensDueForSync(ctx context.Context, now time.Time) ([]accounts.SimpleFinAccessTokenSecret, error)
	SimpleFinTokenSecretByConnID(ctx context.Context, connID int64) (*accounts.SimpleFinAccessTokenSecret, error)
	LinkSimpleFinConnection(ctx context.Context, conn accounts.UpsertSimpleFinConnectionParams) (simpleFinConnID int64, connectionID int64, err error)
	SimpleFinConnectionIDsByExternalID(
		ctx context.Context,
		tokenID int64,
		externalIDs []string,
	) (map[string]int64, error)
	SetSimpleFinConnectionHealth(ctx context.Context, connID int64, state string, errMsg *string, lastSyncedAt time.Time) error
	SetSimpleFinTokenSynced(ctx context.Context, id int64, lastSyncedAt time.Time, nextSyncAt time.Time) error
}

// linkedSimpleFinConnection carries both IDs LinkSimpleFinConnection returns:
// the simplefin_connections row (health updates key on it) and the generic
// connections row (accounts and hidden-account lookups key on it).
type linkedSimpleFinConnection struct {
	SimpleFinConnID int64
	ConnectionID    int64
}

type Adapter struct {
	store    Store
	accounts AccountStore
	client   clients.SimpleFinClient
	now      func() time.Time
	log      *slog.Logger
}

func New(db *database.DB, client clients.SimpleFinClient, now func() time.Time, log *slog.Logger) *Adapter {
	return &Adapter{
		store:    transactionsdb.New(db),
		accounts: accountsdb.New(db),
		client:   client,
		now:      now,
		log:      log,
	}
}

func (a *Adapter) Handles(provider accounts.SourceTable) bool {
	return provider == accounts.SourceTableSimpleFinConnection
}

func (a *Adapter) SyncDue(ctx context.Context, sink transactions.PersistSink) transactions.SyncReport {
	tokens, err := a.accounts.SimpleFinTokensDueForSync(ctx, a.utcNow())
	if err != nil {
		return transactions.SyncReport{Items: []transactions.ItemReport{{Err: err}}}
	}
	syncToken := func(token accounts.SimpleFinAccessTokenSecret) transactions.ItemReport {
		return a.syncToken(ctx, token, sink)
	}
	return transactions.SyncReport{Items: u.Map(tokens, syncToken)}
}

func (a *Adapter) SyncConnectionInto(
	ctx context.Context,
	sourceID int64,
	sink transactions.PersistSink,
) transactions.ItemReport {
	token, err := a.accounts.SimpleFinTokenSecretByConnID(ctx, sourceID)
	if err != nil {
		return transactions.ItemReport{Err: err}
	}
	if token == nil {
		return transactions.ItemReport{Err: fmt.Errorf("simplefin token for connection %d not found", sourceID)}
	}
	return a.syncToken(ctx, *token, sink)
}

func (a *Adapter) syncToken(
	ctx context.Context,
	token accounts.SimpleFinAccessTokenSecret,
	sink transactions.PersistSink,
) transactions.ItemReport {
	startDate := simpleFinStartDate(token.LastSyncedAt, a.utcNow())
	accountSet, err := a.client.GetAccounts(ctx, token.AccessURL, clients.GetAccountsOpts{
		StartDate: startDate,
		Pending:   true,
	})
	if err != nil {
		a.logSync(ctx, token.ID, startDate, nil, nil, err)
		return transactions.ItemReport{Err: err}
	}

	connectionRows, err := a.upsertConnections(ctx, token, accountSet.Connections)
	if err != nil {
		return transactions.ItemReport{Err: err}
	}
	a.setConnectionHealth(ctx, accountSet, connectionRows, token.ID)
	partial := len(accountSet.Errors) > 0

	pendingIDs, err := a.store.PendingSimpleFinTransactionIDs(ctx, token.ID)
	if err != nil {
		return transactions.ItemReport{Err: err}
	}
	pendingByID := lo.Keyify(pendingIDs)
	hiddenByConnection := map[int64]map[string]bool{}

	fetchedTxnIDs := map[string]bool{}
	rawTxnIDs := make([]string, 0)
	removed := make([]string, 0)
	persist := transactions.WithPersist(ctx, sink, func(events chan<- transactions.PersistEvent) error {
		for _, account := range accountSet.Accounts {
			conn, ok := connectionRows[account.ConnID]
			if !ok {
				continue
			}
			fields := accounts.FieldsFromSimpleFinAccount(account)
			events <- transactions.PersistEvent{AccountUpsert: &transactions.AccountDraft{
				ID:           fields.ID,
				ConnectionID: conn.ConnectionID,
				OwnerID:      token.OwnerID,
				Name:         fields.Name,
				Type:         fields.Type,
				Mask:         fields.Mask,
				NeedsReview:  fields.NeedsReview,
			}}

			hidden, ok := hiddenByConnection[conn.ConnectionID]
			if !ok {
				hidden, err = a.accounts.HiddenAccountIDsByConnection(ctx, conn.ConnectionID)
				if err != nil {
					return err
				}
				hiddenByConnection[conn.ConnectionID] = hidden
			}
			for _, sfTxn := range account.Transactions {
				draft, err := transactionFromSimpleFin(account.ID, sfTxn, hidden[account.ID])
				if err != nil {
					return err
				}
				fetchedTxnIDs[sfTxn.ID] = true
				rawTxnIDs = append(rawTxnIDs, sfTxn.ID)
				events <- transactions.PersistEvent{Upsert: &draft}
			}
		}
		if !partial {
			for id := range pendingByID {
				if fetchedTxnIDs[id] {
					continue
				}
				removed = append(removed, id)
				events <- transactions.PersistEvent{Removal: &transactions.RemovedTransaction{ID: id, Source: transactions.TransactionSourceSimpleFin}}
			}
		}
		return nil
	})
	if persist.Err != nil {
		a.logSync(ctx, token.ID, startDate, rawTxnIDs, removed, persist.Err)
		return transactions.ItemReport(persist)
	}
	if partial {
		return transactions.ItemReport{Counts: persist.Counts}
	}
	now := a.utcNow()
	next, err := u.NextAfter(token.SyncCron, now)
	if err != nil {
		return transactions.ItemReport{Counts: persist.Counts, Err: err}
	}
	if err := a.accounts.SetSimpleFinTokenSynced(ctx, token.ID, now, next); err != nil {
		return transactions.ItemReport{Counts: persist.Counts, Err: err}
	}
	a.logSync(ctx, token.ID, startDate, rawTxnIDs, removed, nil)
	return transactions.ItemReport{Counts: persist.Counts}
}

func (a *Adapter) upsertConnections(
	ctx context.Context,
	token accounts.SimpleFinAccessTokenSecret,
	connections []clients.SimpleFinConnection,
) (map[string]linkedSimpleFinConnection, error) {
	linked := make(map[string]linkedSimpleFinConnection, len(connections))
	for _, conn := range connections {
		params := accounts.NewUpsertSimpleFinConnectionParams(token.ID, token.OwnerID, conn)
		simpleFinConnID, connectionID, err := a.accounts.LinkSimpleFinConnection(ctx, params)
		if err != nil {
			return nil, fmt.Errorf("link simplefin connection %s: %w", conn.ConnID, err)
		}
		linked[conn.ConnID] = linkedSimpleFinConnection{SimpleFinConnID: simpleFinConnID, ConnectionID: connectionID}
	}
	return linked, nil
}

func (a *Adapter) utcNow() time.Time {
	return a.now().UTC()
}
