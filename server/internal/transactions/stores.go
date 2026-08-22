package transactions

import (
	"context"

	"tallyo/internal/transactions/categorizer"

	"tallyo/internal/graph/model"
)

// Store is the combined interface for all transaction-domain operations.
type Store interface {
	CategoryStore
	ImportExportStore
	LLMQueueStore
	LLMStore
	RecurringStore
	ReportStore
	TagStore
	TransactionStore
	PersistStore
}

type TagStore interface {
	Tags(ctx context.Context) ([]*model.Tag, error)
	TagByID(ctx context.Context, id int64) (*model.Tag, error)
	CreateTag(ctx context.Context, input model.CreateTagInput) (*model.Tag, error)
	UpdateTag(ctx context.Context, input model.UpdateTagInput) (*model.Tag, error)
	DeleteTag(ctx context.Context, id int64) (bool, error)
	TagsByTransactionIDs(ctx context.Context, transactionIDs []int64) (map[int64][]*model.Tag, error)
	TagsByRuleIDs(ctx context.Context, ruleIDs []int64) (map[int64][]*model.Tag, error)
}

// ── CategoryStore (categories, groups, rules) ────────────────────────────────

type CategoryStore interface {
	Categories(ctx context.Context) ([]*model.Category, error)
	CategoriesForLLM(ctx context.Context) ([]categorizer.CategoryRef, error)
	CategoryGroups(ctx context.Context) ([]*model.CategoryGroup, error)
	Category(ctx context.Context, id int64) (*model.Category, error)
	CategoryGroupByID(ctx context.Context, id int64) (*model.CategoryGroup, error)
	CreateCategory(ctx context.Context, input model.CreateCategoryInput) (*model.Category, error)
	UpdateCategory(ctx context.Context, input model.UpdateCategoryInput) (*model.Category, error)
	CreateCategoryGroup(ctx context.Context, input model.CreateCategoryGroupInput) (*model.CategoryGroup, error)
	UpdateCategoryGroup(ctx context.Context, input model.UpdateCategoryGroupInput) (*model.CategoryGroup, error)
	DeleteCategoryGroup(ctx context.Context, id int64) (bool, error)
	DeleteCategory(ctx context.Context, id int64) (bool, error)
	ReorderCategories(ctx context.Context, input model.ReorderCategoriesInput) (*model.CategoryGroup, error)

	Rules(ctx context.Context, input *model.RulesInput) ([]*model.Rule, error)
	RuleByID(ctx context.Context, id int64) (*model.Rule, error)
	CreateRule(ctx context.Context, input model.CreateRuleInput) (*model.Rule, int32, error)
	UpdateRule(ctx context.Context, input model.UpdateRuleInput) (*model.Rule, int32, error)
	DeleteRule(ctx context.Context, id int64) (bool, error)
}

// ── ImportExportStore ────────────────────────────────────────────────────────

type ImportExportStore interface {
	ImportTransactions(ctx context.Context, rows []ImportRow) (ImportResult, error)
	// ExportTransactionPage returns one page ordered by date desc then id desc,
	// plus the cursor to pass for the next page (nil on the last page). Paging
	// keeps each query bounded instead of holding an open result set for the
	// whole export.
	ExportTransactionPage(ctx context.Context, filter *model.TransactionsFilter, cursor *Cursor, limit int) ([]ExportTransaction, *Cursor, error)
}

// ── LLMStore ─────────────────────────────────────────────────────────────────

type LLMStore interface {
	UncategorizedForLLM(ctx context.Context, limit int) ([]categorizer.TransactionInput, error)
	TopMerchantExamples(ctx context.Context, limit int) ([]categorizer.ExampleTransaction, error)
	SimilarCategorizedByMerchants(ctx context.Context, merchantKeys []string, limit int) (map[string][]categorizer.ExampleTransaction, error)
	ApplyLLMCategory(ctx context.Context, transactionID string, categoryID int64) error
	ClearStagedForLLM(ctx context.Context) error
	ClearStagedForLLMByIDs(ctx context.Context, ids []string) error
}

type LLMQueueStore interface {
	CountStagedForLLM(ctx context.Context) (int64, error)
	LLMStagingStore
}

type LLMStagingStore interface {
	StageUncategorizedForLLM(ctx context.Context) (int64, error)
}

// ── RecurringStore ───────────────────────────────────────────────────────────

type RecurringStore interface {
	UpsertRecurringCharge(ctx context.Context, charge RecurringChargeDraft) (int64, error)
	ReplaceChargeTxns(ctx context.Context, chargeID int64, txnIDs []string) error
	MarkRecurringFromStreams(ctx context.Context, itemID int64) error
	GetRecurringCharges(ctx context.Context) ([]*model.RecurringCharge, error)
	RecurringChargeByID(ctx context.Context, id int64) (*model.RecurringCharge, error)
}

// ── ReportStore ──────────────────────────────────────────────────────────────

type ReportStore interface {
	CashFlow(ctx context.Context, filter model.SpendingFilter) ([]*model.CashFlowPeriod, error)
	SpendingByCategory(ctx context.Context, filter model.SpendingFilter) (*model.SpendingByCategoryReport, error)
	// SpendingRows returns aggregated spending data. Used by BudgetReport.
	SpendingRows(ctx context.Context, filter model.SpendingFilter, byCategory, excludeIncome bool) ([]SpendingRow, error)
}

// ── TransactionStore ─────────────────────────────────────────────────────────

type TransactionStore interface {
	Transaction(ctx context.Context, id int64) (*model.Transaction, error)
	Transactions(ctx context.Context, query TransactionQuery) (*model.TransactionConnection, error)
	BulkUpdateTransactions(ctx context.Context, input model.BulkUpdateTransactionsInput) ([]*model.Transaction, error)
	UpdateTransaction(ctx context.Context, id int64, input model.TransactionUpdates) (*model.Transaction, error)
	CreateTransaction(ctx context.Context, input model.CreateTransactionInput) (*model.Transaction, error)
	TransactionsSummary(ctx context.Context, filter *model.TransactionsFilter) (*model.TransactionsSummary, error)
	DeleteTransaction(ctx context.Context, id int64) (bool, error)
	BulkDeleteTransactions(ctx context.Context, input model.BulkDeleteTransactionsInput) (int32, error)
}

// ── PersistStore ─────────────────────────────────────────────────────────────
// The shared-table write subset consumed by the sync persister.

type PersistStore interface {
	DeleteSyncedTransaction(ctx context.Context, source, externalID string) (bool, error)
	UpsertSyncedAccount(ctx context.Context, draft AccountDraft) error
	UpsertSyncedTransaction(ctx context.Context, tx SyncedTransaction) (bool, error)
	UpsertRecurringCharge(ctx context.Context, charge RecurringChargeDraft) (int64, error)
	ReplaceChargeTxns(ctx context.Context, chargeID int64, txnIDs []string) error
	MarkRecurringFromStreams(ctx context.Context, itemID int64) error
}
