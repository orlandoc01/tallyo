package plaid

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"github.com/samber/lo"
)

func (a *Adapter) Handles(_ context.Context, conn wealth.ConnectionRef) (bool, error) {
	return conn.SourceTable == accounts.SourceTablePlaidItem, nil
}

func (a *Adapter) SyncDue(ctx context.Context, sink wealth.PersistSink) error {
	items, err := a.plaid.PlaidItemsDueForBalanceSync(ctx, sink.Now())
	if err != nil {
		return err
	}
	cron, err := a.plaid.BalanceSyncScheduleCron(ctx, syncerids.Plaid)
	if err != nil {
		return err
	}
	for _, item := range items {
		if err := a.SyncItemInto(ctx, item, cron, sink); err != nil {
			a.Log.Error("plaid balance sync item failed", "item_id", item.ID, "error", err)
		}
	}
	return nil
}

func (a *Adapter) SyncConnectionInto(
	ctx context.Context,
	conn wealth.ConnectionRef,
	sink wealth.PersistSink,
) error {
	return wealth.SyncConnectionVia(ctx, sink, "plaid item", conn.SourceID, a.plaid.PlaidItemSecretByID, func(ctx context.Context) (string, error) {
		return a.plaid.BalanceSyncScheduleCron(ctx, syncerids.Plaid)
	}, a.SyncItemInto)
}

func (a *Adapter) SyncItemInto(
	ctx context.Context,
	item accounts.PlaidItemSecret,
	cron string,
	sink wealth.PersistSink,
) error {
	client, err := a.clients.ClientForCredential(ctx, item.CredentialID)
	if err != nil {
		return err
	}

	plaidAccounts, err := client.AccountsBalanceGet(ctx, item.AccessToken)
	if err != nil {
		return fmt.Errorf("accounts balance get: %w", err)
	}
	dbAccounts, err := a.resolveAccounts(ctx, plaidAccounts)
	if err != nil {
		return err
	}
	next, err := wealth.NextBalanceSyncAfter(
		cron,
		sink.Now(),
	)
	if err != nil {
		return err
	}
	if err := wealth.WithPersist(ctx, sink, func(events chan<- wealth.PersistEvent) error {
		isInvestment := func(account resolvedAccount) bool { return account.Type == model.AccountTypeInvestment }
		if lo.SomeBy(lo.Values(dbAccounts), isInvestment) {
			holdings, err := client.InvestmentsHoldingsGet(ctx, item.AccessToken)
			if err != nil {
				a.Log.Error("investments holdings get failed", "item_id", item.ID, "error", err)
			} else if err := a.reconcileHoldings(ctx, holdings, plaidAccounts, dbAccounts, sink, events); err != nil {
				return err
			}
		}
		return a.reconcileBalances(ctx, plaidAccounts, dbAccounts, sink, events)
	}); err != nil {
		a.Log.Warn("persist plaid item snapshots failed", "item_id", item.ID, "error", err)
		return err
	}
	return a.plaid.SetItemBalanceSynced(ctx, item.ID, next)
}

// ID 0 means the account is not in the DB; Type then falls back to Plaid's.
type resolvedAccount struct {
	ID   int64
	Type model.AccountType
}

func (a *Adapter) resolveAccounts(
	ctx context.Context,
	plaidAccounts []plaidapi.AccountBase,
) (map[string]resolvedAccount, error) {
	resolved := make(map[string]resolvedAccount, len(plaidAccounts))
	for _, pa := range plaidAccounts {
		externalID := pa.GetAccountId()
		id, accountType, err := a.Reads.AccountByExternalID(ctx, externalID)
		if errors.Is(err, sql.ErrNoRows) {
			resolved[externalID] = resolvedAccount{Type: accounts.TypeFromPlaid(string(pa.GetType()))}
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("lookup account type %s: %w", externalID, err)
		}
		resolved[externalID] = resolvedAccount{ID: id, Type: accountType}
	}
	return resolved, nil
}

func (a *Adapter) reconcileBalances(
	ctx context.Context,
	plaidAccounts []plaidapi.AccountBase,
	dbAccounts map[string]resolvedAccount,
	sink wealth.PersistSink,
	events chan<- wealth.PersistEvent,
) error {
	usd, err := a.Reads.AssetByID(ctx, 1)
	if err != nil {
		return err
	}
	syncedAt := sink.Now().Format(time.RFC3339)
	usdPrice := 1.0
	for _, account := range plaidAccounts {
		resolved := dbAccounts[account.GetAccountId()]
		if resolved.Type == model.AccountTypeInvestment {
			continue
		}
		balances := account.GetBalances()
		balance, ok := balances.GetCurrentOk()
		if !ok || balance == nil {
			continue
		}
		if resolved.ID == 0 {
			return fmt.Errorf("lookup account %s: %w", account.GetAccountId(), sql.ErrNoRows)
		}
		draft := wealth.SnapshotDraft{
			AccountBalanceSnapshot: wealth.AccountBalanceSnapshot{
				AccountID:  resolved.ID,
				Source:     a.Source().Str(),
				Date:       sink.Today(),
				SyncedAt:   syncedAt,
				BalanceUSD: money.FromDollars(*balance),
				Holdings: []wealth.AssetDailyHolding{{
					AssetID:           usd.ID.Int64(),
					Quantity:          balance,
					Price:             &usdPrice,
					ValueUSD:          *balance,
					CountsTowardValue: true,
				}},
			},
			Decision: wealth.DecisionClean,
		}
		events <- wealth.PersistEvent{Snapshot: &draft}
	}
	return nil
}
