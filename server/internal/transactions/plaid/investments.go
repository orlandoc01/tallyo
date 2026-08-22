package txnplaid

import (
	"fmt"
	"maps"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/transactions"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"github.com/samber/lo"
)

const investmentTransactionsPageSize int32 = 500

// syncMixedItem syncs an item that has both transaction-syncable
// (depository/credit) accounts and investment accounts.
func (s *itemSync) syncMixedItem(
	investmentAccountIDs []string,
) transactions.ItemReport {
	a := s.adapter
	item := s.item
	var nextCursor string
	var itemErr error
	var reportErr error
	persist := transactions.WithPersist(s.ctx, s.sink, func(events chan<- transactions.PersistEvent) error {
		s.streamAccountDrafts(events)
		if err := s.streamInvestmentTransactions(investmentAccountIDs, events); err != nil {
			itemErr = err
			reportErr = fmt.Errorf("sync investment transactions %d: %w", item.ID, err)
			return reportErr
		}
		cursor, err := s.streamTransactions(investmentAccountIDs, events)
		if err != nil {
			itemErr = err
			reportErr = fmt.Errorf("sync transactions %d: %w", item.ID, err)
			return reportErr
		}
		nextCursor = cursor
		return nil
	})
	if reportErr != nil {
		a.recordItemSyncError(s.ctx, item.ID, itemErr)
		return transactions.ItemReport{
			Counts: persist.Counts,
			Err:    reportErr,
		}
	}
	return s.finalizeCursorSync(persist, nextCursor)
}

// syncCursorlessItem syncs an item with no depository/credit accounts. Plaid's
// investments endpoint has no sync cursor, so a successful fetch (or having
// nothing to fetch at all) is sufficient to advance next_sync_at.
func (s *itemSync) syncCursorlessItem(
	investmentAccountIDs []string,
) transactions.ItemReport {
	a := s.adapter
	item := s.item
	var itemErr error
	var reportErr error
	persist := transactions.WithPersist(s.ctx, s.sink, func(events chan<- transactions.PersistEvent) error {
		s.streamAccountDrafts(events)
		if len(investmentAccountIDs) == 0 {
			return nil
		}
		if err := s.streamInvestmentTransactions(investmentAccountIDs, events); err != nil {
			itemErr = err
			reportErr = fmt.Errorf("sync investment transactions %d: %w", item.ID, err)
			return reportErr
		}
		return nil
	})
	if reportErr != nil {
		a.recordItemSyncError(s.ctx, item.ID, itemErr)
		return transactions.ItemReport{
			Counts: persist.Counts,
			Err:    reportErr,
		}
	}
	return s.finalizeCursorlessPersist(persist)
}

func (s *itemSync) finalizeCursorlessPersist(persist transactions.PersistResult) transactions.ItemReport {
	if persist.Err != nil {
		s.adapter.logPersistError(s.item.ID, persist.Err)
		return transactions.ItemReport(persist)
	}
	return s.finalizeCursorlessSync(persist.Counts)
}

func (s *itemSync) streamInvestmentTransactions(
	investmentAccountIDs []string,
	events chan<- transactions.PersistEvent,
) error {
	a := s.adapter
	item := s.item
	hiddenAccounts, err := s.hiddenAccounts()
	if err != nil {
		return err
	}

	startDate, endDate := a.investmentTransactionDateRange(item)
	institutionName := ""
	if item.InstitutionName != nil {
		institutionName = *item.InstitutionName
	}
	loggedTransactions := []plaidapi.InvestmentTransaction{}
	securities := make(map[string]plaidapi.Security)
	toSecurityByID := func(security plaidapi.Security) (string, plaidapi.Security) {
		return security.GetSecurityId(), security
	}
	var offset int32
	for {
		resp, err := s.client.InvestmentsTransactionsGet(
			s.ctx,
			item.AccessToken,
			startDate,
			endDate,
			investmentAccountIDs,
			investmentTransactionsPageSize,
			offset,
		)
		if err != nil {
			return err
		}
		maps.Copy(securities, lo.SliceToMap(resp.GetSecurities(), toSecurityByID))
		investmentTransactions := resp.GetInvestmentTransactions()
		for _, itx := range investmentTransactions {
			synced, err := convertInvestmentTransaction(itx, securities, institutionName, item.LogoURL)
			if err != nil {
				return err
			}
			synced.HiddenByAccount = hiddenAccounts[synced.AccountID]
			events <- transactions.PersistEvent{Upsert: &synced}
			loggedTransactions = append(loggedTransactions, itx)
		}
		offset += int32(len(investmentTransactions))
		if offset >= resp.GetTotalInvestmentTransactions() || len(investmentTransactions) == 0 {
			break
		}
	}
	if err := a.logInvestmentSyncBatch(s.ctx, item.ID, loggedTransactions); err != nil {
		a.Log.Error("failed to write investment sync log", "item_id", item.ID, "error", err)
	}
	return nil
}

func (a *Adapter) investmentTransactionDateRange(item accounts.PlaidItemSecret) (string, string) {
	now := a.utcNow()
	start := now.AddDate(0, 0, -30)
	if item.LastSyncedAt != nil {
		start = item.LastSyncedAt.UTC().AddDate(0, 0, -7)
	}
	return start.Format(time.DateOnly), now.Format(time.DateOnly)
}
