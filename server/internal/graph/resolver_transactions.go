package graph

import (
	"context"
	"errors"
	"fmt"

	"tallyo/internal/apierror"
	"tallyo/internal/database"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"
)

func (r *Resolver) Transactions(ctx context.Context, input *model.TransactionsInput) (*model.TransactionConnection, error) {
	q, err := transactionQueryFromInput(input)
	if err != nil {
		return nil, err
	}
	return r.TransactionsStore.Transactions(ctx, q)
}

func transactionQueryFromInput(input *model.TransactionsInput) (transactions.TransactionQuery, error) {
	q := transactions.TransactionQuery{}
	if input != nil {
		q.Filter = input.Filter
		if err := model.ValidateTransactionsFilterIDTypes(q.Filter); err != nil {
			return transactions.TransactionQuery{}, err
		}
		q.Sort = input.Sort
		q.First = input.First
		q.After = input.After
		q.Last = input.Last
		q.Before = input.Before
		if err := validateTransactionPageArgs(q); err != nil {
			return transactions.TransactionQuery{}, err
		}
	}
	return q, nil
}

func validateTransactionPageArgs(q transactions.TransactionQuery) error {
	if q.First != nil && q.Last != nil {
		return apierror.Publicf("cannot supply both first and last")
	}
	if q.After != nil && q.Before != nil {
		return apierror.Publicf("cannot supply both after and before")
	}
	if err := validatePageSize("first", q.First); err != nil {
		return err
	}
	return validatePageSize("last", q.Last)
}

func validatePageSize(name string, size *int32) error {
	if size == nil {
		return nil
	}
	if *size <= 0 {
		return apierror.Publicf("%s must be positive", name)
	}
	if *size > transactions.MaxTransactionLimit {
		return apierror.Publicf("%s must not exceed %d", name, transactions.MaxTransactionLimit)
	}
	return nil
}

func (r *Resolver) GetTransaction(ctx context.Context, id model.GlobalID) (*model.Transaction, error) {
	transactionID, err := id.Int64OfType(model.GlobalIDTransaction)
	if err != nil {
		return nil, err
	}
	return r.TransactionsStore.Transaction(ctx, transactionID)
}

func (r *Resolver) TransactionsSummary(ctx context.Context, filter *model.TransactionsFilter) (*model.TransactionsSummary, error) {
	if err := model.ValidateTransactionsFilterIDTypes(filter); err != nil {
		return nil, err
	}
	return r.TransactionsStore.TransactionsSummary(ctx, filter)
}

func (r *Resolver) TransactionsStagedForCategorization(ctx context.Context) (*model.TransactionsStagedForCategorization, error) {
	count, err := r.TransactionsStore.CountStagedForLLM(ctx)
	if err != nil {
		return nil, fmt.Errorf("count transactions staged for categorization: %w", err)
	}
	return &model.TransactionsStagedForCategorization{Count: int32(count)}, nil
}

func (r *Resolver) ReprocessUncategorizedTransactions(ctx context.Context) (*model.ReprocessUncategorizedTransactionsPayload, error) {
	staged, err := r.LLM.ReprocessUncategorized(ctx, r.TransactionsStore)
	if errors.Is(err, transactions.ErrLLMDisabled) {
		return nil, apierror.Publicf("LLM categorization is not enabled")
	}
	if err != nil {
		return nil, fmt.Errorf("stage uncategorized for llm: %w", err)
	}
	return &model.ReprocessUncategorizedTransactionsPayload{StagedCount: int32(staged)}, nil
}

func (r *Resolver) BulkUpdateTransactions(ctx context.Context, input model.BulkUpdateTransactionsInput) (*model.BulkUpdateTransactionsPayload, error) {
	if input.Updates == nil {
		return nil, apierror.Publicf("updates is required")
	}
	if _, err := model.LocalInt64IDsOfTypePtr(input.TransactionIds, model.GlobalIDTransaction); err != nil {
		return nil, err
	}
	if err := model.ValidateTransactionsFilterIDTypes(input.Filter); err != nil {
		return nil, err
	}
	if err := validateTransactionUpdateIDTypes(*input.Updates); err != nil {
		return nil, err
	}
	transactions, err := r.TransactionsStore.BulkUpdateTransactions(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.BulkUpdateTransactionsPayload{UpdatedCount: int32(len(transactions)), Transactions: transactions}, nil
}

func (r *Resolver) UpdateTransaction(ctx context.Context, input model.UpdateTransactionInput) (*model.UpdateTransactionPayload, error) {
	if input.Updates == nil {
		return nil, apierror.Publicf("updates is required")
	}
	transactionID, err := input.ID.Int64OfType(model.GlobalIDTransaction)
	if err != nil {
		return nil, err
	}
	updates := *input.Updates
	if err := validateTransactionUpdateIDTypes(updates); err != nil {
		return nil, err
	}
	transaction, err := r.TransactionsStore.UpdateTransaction(ctx, transactionID, updates)
	if errors.Is(err, database.ErrNotFound) {
		return nil, apierror.Publicf("transaction not found")
	}
	if err != nil {
		return nil, err
	}
	if transaction == nil {
		return nil, apierror.Publicf("transaction not found")
	}
	return &model.UpdateTransactionPayload{Transaction: transaction}, nil
}

func validateTransactionUpdateIDTypes(input model.TransactionUpdates) error {
	if err := validateOptionalGlobalID(input.CategoryID, model.GlobalIDCategory); err != nil {
		return err
	}
	_, err := model.LocalInt64IDsOfTypePtr(input.TagIds, model.GlobalIDTag)
	return err
}

func (r *Resolver) DeleteTransaction(ctx context.Context, id model.GlobalID) (*model.DeleteTransactionPayload, error) {
	transactionID, err := id.Int64OfType(model.GlobalIDTransaction)
	if err != nil {
		return nil, err
	}
	success, err := r.TransactionsStore.DeleteTransaction(ctx, transactionID)
	if err != nil {
		return nil, err
	}
	return &model.DeleteTransactionPayload{Success: success}, nil
}

func (r *Resolver) BulkDeleteTransactions(ctx context.Context, input model.BulkDeleteTransactionsInput) (*model.BulkDeleteTransactionsPayload, error) {
	if _, err := model.LocalInt64IDsOfTypePtr(input.TransactionIds, model.GlobalIDTransaction); err != nil {
		return nil, err
	}
	if err := model.ValidateTransactionsFilterIDTypes(input.Filter); err != nil {
		return nil, err
	}
	deleted, err := r.TransactionsStore.BulkDeleteTransactions(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.BulkDeleteTransactionsPayload{DeletedCount: deleted}, nil
}

func (r *Resolver) CreateTransaction(ctx context.Context, input model.CreateTransactionInput) (*model.CreateTransactionPayload, error) {
	if err := validateCreateTransactionInput(input); err != nil {
		return nil, err
	}
	transaction, err := r.TransactionsStore.CreateTransaction(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.CreateTransactionPayload{Transaction: transaction}, nil
}

func validateCreateTransactionInput(input model.CreateTransactionInput) error {
	if err := input.AccountID.ValidateType(model.GlobalIDAccount); err != nil {
		return err
	}
	return validateOptionalGlobalID(input.CategoryID, model.GlobalIDCategory)
}
