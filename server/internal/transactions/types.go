package transactions

import (
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
)

// TransactionQuery carries all list-transaction parameters to the store.
type TransactionQuery struct {
	Filter *model.TransactionsFilter
	Sort   *model.TransactionSort
	First  *int32
	After  *string
	Last   *int32
	Before *string
}

const MaxTransactionLimit = int32(1000)
const defaultTransactionLimit = int32(50)

func TransactionLimit(query TransactionQuery) int32 {
	if query.First != nil && *query.First > 0 {
		return min(*query.First, MaxTransactionLimit)
	}
	if query.Last != nil && *query.Last > 0 {
		return min(*query.Last, MaxTransactionLimit)
	}
	return defaultTransactionLimit
}

// Cursor encodes the position in a keyset-paginated transaction query.
type Cursor struct {
	Datetime string      `json:"datetime"`
	ID       int64       `json:"id"`
	Amount   money.Cents `json:"amount,omitempty"`
}

// SpendingRow is one aggregated row returned by spending reports.
type SpendingRow struct {
	PeriodLabel      string
	PeriodStart      model.Date
	PeriodEnd        model.Date
	Category         *model.Category
	TotalCents       money.Cents
	TransactionCount int32
}

// SyncedTransaction is the normalised provider transaction ready for upsert.
type SyncedTransaction struct {
	ExternalID      string
	AccountID       string
	Amount          float64
	Datetime        time.Time
	PostedDatetime  time.Time
	MerchantName    *string
	OriginalName    *string
	LogoURL         *string
	PlaidCategory   *string
	RawProviderJSON *string
	Source          string
	Pending         bool
	HiddenByAccount bool
	StageForLLM     bool
}

const (
	TransactionSourcePlaid     = "plaid"
	TransactionSourceManual    = "manual"
	TransactionSourceSimpleFin = "simplefin"
)

// ExportTransaction carries the provider identifier alongside the GraphQL model
// so CSV export can preserve its historical id column.
type ExportTransaction struct {
	ExternalID  string
	Source      string
	Transaction *model.Transaction
}

const (
	SyncBatchAPITransactions = "transactions"
	SyncBatchAPIInvestments  = "investments"
)

// SyncBatchLog captures the raw Plaid sync payload for one item for audit purposes.
type SyncBatchLog struct {
	ItemID   int64
	API      string
	Added    string // JSON array of full Plaid transaction objects
	Modified string // JSON array of full Plaid transaction objects
	Removed  string // JSON array of Plaid RemovedTransaction objects
}

// ImportRow is one parsed data row from a CSV import.
type ImportRow struct {
	RowNum         int // 1-indexed CSV data row; used for error messages
	ExternalID     string
	Source         string
	AccountID      string
	Datetime       time.Time // YYYY-MM-DD is normalized to noon UTC
	PostedDatetime time.Time // defaults to Datetime when absent
	Amount         money.Cents
	MerchantName   string
	OriginalName   string
	Category       string
	Notes          string
	IsRecurring    bool
	IsHidden       bool
}

// ImportRowError describes a validation or insertion failure for one CSV row.
type ImportRowError struct {
	Row     int    `json:"row"`
	Message string `json:"message"`
}

// ImportResult summarises the outcome of ImportTransactions.
type ImportResult struct {
	Processed int              `json:"processed"`
	Skipped   int              `json:"skipped"`
	Errors    []ImportRowError `json:"errors"`
}
