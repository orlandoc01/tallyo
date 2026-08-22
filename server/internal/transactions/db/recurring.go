package transactionsdb

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/samber/lo"

	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
	u "tallyo/internal/utils"
)

func (s *Store) UpsertRecurringCharge(ctx context.Context, charge transactions.RecurringChargeDraft) (int64, error) {
	row, err := accountsdb.AccountByExternalID(ctx, s.q, charge.AccountID)
	if err != nil {
		return 0, err
	}
	accountID := row.Account.ID
	return s.q.UpsertRecurringCharge(ctx, dbgen.UpsertRecurringChargeParams{
		ExternalID:         charge.ExternalID,
		AccountID:          accountID,
		Description:        charge.Description,
		MerchantName:       charge.MerchantName,
		Frequency:          charge.Frequency,
		Status:             charge.Status,
		IsActive:           charge.IsActive,
		AverageAmountCents: money.FromDollars(charge.AverageAmount),
		LastAmountCents:    money.FromDollars(charge.LastAmount),
		FirstDate:          charge.FirstDate,
		LastDate:           charge.LastDate,
		IsUserModified:     charge.IsUserModified,
	})
}

func (s *Store) ReplaceChargeTxns(ctx context.Context, chargeID int64, txnIDs []string) error {
	return s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		if err := q.DeleteRecurringChargeTransactions(ctx, dbgen.DeleteRecurringChargeTransactionsParams{ChargeID: chargeID}); err != nil {
			return err
		}
		if len(txnIDs) == 0 {
			return nil
		}
		return q.InsertRecurringChargeTransactions(ctx, dbgen.InsertRecurringChargeTransactionsParams{ChargeID: chargeID, PlaidTxnIds: txnIDs})
	})
}

func (s *Store) MarkRecurringFromStreams(ctx context.Context, itemID int64) error {
	_, err := s.SQL().ExecContext(ctx, updateRecurringTransactionsForPlaidItemSQL, itemID)
	return err
}

// ponytail: sqlc rejects SQLite WITH UPDATE; move this back to sqlc when it does not.
const updateRecurringTransactionsForPlaidItemSQL = `
WITH item_accounts(id) AS (
  SELECT a.id
  FROM accounts a
  JOIN connections c ON c.id = a.connection_id
  WHERE c.source_id = ?
    AND c.source_table = 'plaid_items'
), active_transaction_ids(transaction_id) AS (
  SELECT rct.transaction_id
  FROM recurring_charge_transactions rct
  JOIN recurring_charges rc ON rc.id = rct.charge_id
  WHERE rc.is_active = 1
    AND rc.account_id IN (SELECT id FROM item_accounts)
)
UPDATE transactions
SET is_recurring = EXISTS (
  SELECT 1 FROM active_transaction_ids WHERE transaction_id = transactions.id
)
WHERE account_id IN (SELECT id FROM item_accounts)
  AND is_recurring <> EXISTS (
    SELECT 1 FROM active_transaction_ids WHERE transaction_id = transactions.id
  )`

func (s *Store) GetRecurringCharges(ctx context.Context) ([]*model.RecurringCharge, error) {
	rows, err := s.q.ListRecurringCharges(ctx, dbgen.ListRecurringChargesParams{})
	if err != nil {
		return nil, err
	}
	return s.recurringChargesFromRows(ctx, rows)
}

func (s *Store) RecurringChargeByID(ctx context.Context, id int64) (*model.RecurringCharge, error) {
	rows, err := s.q.ListRecurringCharges(ctx, dbgen.ListRecurringChargesParams{ID: &id})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	charges, err := s.recurringChargesFromRows(ctx, rows)
	if err != nil {
		return nil, err
	}
	return charges[0], nil
}

func (s *Store) recurringChargesFromRows(ctx context.Context, rows []dbgen.ListRecurringChargesRow) ([]*model.RecurringCharge, error) {
	if len(rows) == 0 {
		return []*model.RecurringCharge{}, nil
	}
	chargeID := func(row dbgen.ListRecurringChargesRow) int64 { return row.ID }
	chargeIDs := u.Map(rows, chargeID)

	txnIDsByCharge, err := s.recurringChargeTransactionIDs(ctx, chargeIDs)
	if err != nil {
		return nil, fmt.Errorf("txn ids: %w", err)
	}
	txnsByID, err := s.recurringTransactionsByID(ctx, txnIDsByCharge)
	if err != nil {
		return nil, err
	}
	categoriesByCharge, err := s.recurringChargeCategories(ctx, chargeIDs)
	if err != nil {
		return nil, err
	}

	toCharge := func(row dbgen.ListRecurringChargesRow) *model.RecurringCharge {
		return recurringChargeFromRow(
			row,
			recurringChargeTransactions(txnIDsByCharge[row.ID], txnsByID),
			categoriesByCharge[row.ID],
		)
	}
	return u.Map(rows, toCharge), nil
}

func (s *Store) recurringChargeTransactionIDs(ctx context.Context, chargeIDs []int64) (map[int64][]int64, error) {
	rows, err := s.q.RecurringChargeTransactionIDsByChargeIDs(ctx, dbgen.RecurringChargeTransactionIDsByChargeIDsParams{ChargeIds: chargeIDs})
	toChargeTxnID := func(row dbgen.RecurringChargeTransaction) (int64, int64) {
		return row.ChargeID, row.TransactionID
	}
	return dbutil.GroupRows(rows, err, toChargeTxnID)
}

func (s *Store) recurringTransactionsByID(ctx context.Context, txnIDsByCharge map[int64][]int64) (map[int64]*model.Transaction, error) {
	txnIDs := lo.Uniq(lo.Flatten(lo.Values(txnIDsByCharge)))
	if len(txnIDs) == 0 {
		return map[int64]*model.Transaction{}, nil
	}
	txns, err := s.transactionsByID(ctx, txnIDs)
	toTxnByID := func(txn *model.Transaction) (int64, *model.Transaction) {
		return txn.ID.Int64(), txn
	}
	return dbutil.AssociateRows(txns, err, toTxnByID)
}

func (s *Store) recurringChargeCategories(ctx context.Context, chargeIDs []int64) (map[int64]*model.Category, error) {
	rows, err := s.q.MajorityCategoriesForRecurringCharges(ctx, dbgen.MajorityCategoriesForRecurringChargesParams{ChargeIds: chargeIDs})
	toCategoryByChargeID := func(row dbgen.MajorityCategoriesForRecurringChargesRow) (int64, *model.Category) {
		return row.ChargeID, categoryFromRecurringChargeRow(row)
	}
	return dbutil.AssociateRows(rows, err, toCategoryByChargeID)
}

func categoryFromRecurringChargeRow(row dbgen.MajorityCategoriesForRecurringChargesRow) *model.Category {
	return categoryFromRow(dbgen.CategoryRow{
		CatID:          row.CatID,
		CatName:        row.CatName,
		CatEmoji:       row.CatEmoji,
		GroupName:      row.GroupName,
		GroupEmoji:     row.GroupEmoji,
		GroupKind:      row.GroupKind,
		SortOrder:      row.SortOrder,
		GroupID:        row.GroupID,
		PlaidPfc2Codes: row.PlaidPfc2Codes,
	})
}

func recurringChargeTransactions(txnIDs []int64, txnsByID map[int64]*model.Transaction) []*model.Transaction {
	toTxn := func(id int64, _ int) (*model.Transaction, bool) {
		txn, ok := txnsByID[id]
		return txn, ok
	}
	return lo.FilterMap(txnIDs, toTxn)
}

func recurringChargeFromRow(row dbgen.ListRecurringChargesRow, txns []*model.Transaction, category *model.Category) *model.RecurringCharge {
	interval := PlaidFrequencyToInterval(row.Frequency)
	lastDate := model.Date(row.LastDate)
	merchant := row.Description
	if row.MerchantName != nil && *row.MerchantName != "" {
		merchant = *row.MerchantName
	}
	nextDate := NextExpectedDate(lastDate, interval)

	status := PlaidStatusToModel(row.Status)
	return &model.RecurringCharge{
		ID:               model.New(model.GlobalIDRecurringCharge, row.ID),
		MerchantName:     merchant,
		EstimatedAmount:  row.AverageAmountCents,
		Interval:         interval,
		Category:         category,
		Transactions:     txns,
		FirstDate:        model.Date(row.FirstDate),
		LastDate:         lastDate,
		LastAmount:       row.LastAmountCents,
		IsUserModified:   row.IsUserModified,
		NextExpectedDate: nextDate,
		Status:           status,
		IsActive:         row.IsActive,
	}
}

func PlaidFrequencyToInterval(freq string) *model.RecurrenceInterval {
	if interval, ok := plaidFrequencyIntervals[freq]; ok {
		return &interval
	}
	return nil
}

var plaidFrequencyIntervals = map[string]model.RecurrenceInterval{
	"WEEKLY":       model.RecurrenceIntervalWeekly,
	"BIWEEKLY":     model.RecurrenceIntervalBiweekly,
	"SEMI_MONTHLY": model.RecurrenceIntervalBiweekly,
	"MONTHLY":      model.RecurrenceIntervalMonthly,
	"ANNUALLY":     model.RecurrenceIntervalYearly,
}

func PlaidStatusToModel(status string) model.RecurringStreamStatus {
	switch status {
	case "MATURE":
		return model.RecurringStreamStatusMature
	case "EARLY_DETECTION":
		return model.RecurringStreamStatusEarlyDetection
	case "TOMBSTONED":
		return model.RecurringStreamStatusTombstoned
	default:
		return model.RecurringStreamStatusUnknown
	}
}

func NextExpectedDate(lastDate model.Date, interval *model.RecurrenceInterval) *model.Date {
	if interval == nil {
		return nil
	}
	t, err := time.Parse(time.DateOnly, string(lastDate))
	if err != nil {
		return nil
	}
	var next time.Time
	switch *interval {
	case model.RecurrenceIntervalWeekly:
		next = t.AddDate(0, 0, 7)
	case model.RecurrenceIntervalBiweekly:
		next = t.AddDate(0, 0, 14)
	case model.RecurrenceIntervalMonthly:
		next = t.AddDate(0, 1, 0)
	case model.RecurrenceIntervalQuarterly:
		next = t.AddDate(0, 3, 0)
	case model.RecurrenceIntervalYearly:
		next = t.AddDate(1, 0, 0)
	default:
		return nil
	}
	d := model.Date(next.Format(time.DateOnly))
	return &d
}
