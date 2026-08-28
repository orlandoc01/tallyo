package transactionsdb

import (
	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
)

func transactionFromRow(row dbgen.TransactionRecordsRow) *model.Transaction {
	return &model.Transaction{
		ID:             model.New(model.GlobalIDTransaction, row.ID),
		Amount:         row.AmountCents,
		Datetime:       row.Datetime,
		PostedDatetime: row.PostedDatetime,
		MerchantName:   row.MerchantName,
		OriginalName:   row.OriginalName,
		LogoURL:        row.LogoUrl,
		IsRecurring:    row.IsRecurring,
		IsReviewed:     row.IsReviewed,
		Notes:          row.Notes,
		PlaidCategory:  row.PlaidCategory,
		Pending:        row.Pending,
		IsHidden:       row.IsHidden,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
		Account:        accountsdb.AccountFromRow(row.Account, row.OwnerName),
		Category:       CategoryFromRow(row.CategoryRow),
	}
}

func transactionRowsToModels(rows []dbgen.TransactionRecordsRow) []*model.Transaction {
	return u.Map(rows, transactionFromRow)
}
