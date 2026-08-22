package transactions

import (
	"context"
	"log/slog"

	"tallyo/internal/accounts"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions/categorizer"
)

type Categorizer interface {
	CategorizeBatch(
		ctx context.Context,
		txns []categorizer.TransactionInput,
		globalExamples []categorizer.ExampleTransaction,
	) ([]categorizer.LLMResult, error)
	// BatchSize is how many transactions the worker sends per CategorizeBatch
	// call — per-provider, since local models and frontier CLIs have very
	// different reliable batch ceilings.
	BatchSize() int
}

type SyncAdapter interface {
	Handles(provider accounts.SourceTable) bool
	SyncDue(ctx context.Context, sink PersistSink) SyncReport
	SyncConnectionInto(ctx context.Context, sourceID int64, sink PersistSink) ItemReport
}

type PersistSink interface {
	Open(ctx context.Context) (events chan<- PersistEvent, result <-chan PersistResult)
}

type PersistEvent struct {
	AccountUpsert *AccountDraft
	Upsert        *SyncedTransaction
	Removal       *RemovedTransaction
	Recurring     *RecurringChargeDraft
	MarkRecurring *MarkRecurringStep
}

type PersistResult struct {
	Counts ItemCounts
	Err    error
}

type ItemCounts struct {
	AccountsUpserted int
	Added            int
	Modified         int
	Removed          int
}

type AccountDraft struct {
	ID           string
	ConnectionID int64
	OwnerID      int64
	Name         string
	Type         model.AccountType
	Subtype      *string
	Mask         *string
	NeedsReview  bool
}

type RemovedTransaction struct {
	ID     string
	Source string
}

type MarkRecurringStep struct {
	SourceID int64
}

type RecurringChargeDraft struct {
	ExternalID     string
	AccountID      string
	Description    string
	MerchantName   *string
	Frequency      string
	Status         string
	IsActive       bool
	AverageAmount  float64
	LastAmount     float64
	FirstDate      string
	LastDate       string
	IsUserModified bool
	TransactionIDs []string
}

type BaseAdapter struct {
	Reads AdapterReadStore
	Log   *slog.Logger
}

type AdapterReadStore interface {
	SyncableAccountExternalIDsByItem(ctx context.Context, itemID int64) ([]string, error)
	HiddenAccountIDsByConnection(ctx context.Context, connectionID int64) (map[string]bool, error)
	ConnectionByPlaidItemID(ctx context.Context, plaidItemID int64) (*model.Connection, error)
}

type SyncReport struct {
	Items []ItemReport
}

type ItemReport struct {
	Counts ItemCounts
	Err    error
}

type LLMConfigurable interface {
	SetLLM(Categorizer)
}
