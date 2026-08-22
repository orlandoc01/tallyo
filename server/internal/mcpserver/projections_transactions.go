package mcpserver

import (
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	u "tallyo/internal/utils"
)

type leanTransaction struct {
	ID             string      `json:"id"`
	AccountID      string      `json:"accountId"`
	AccountName    string      `json:"accountName"`
	Amount         money.Cents `json:"amount"`
	Datetime       time.Time   `json:"datetime"`
	PostedDatetime time.Time   `json:"postedDatetime"`
	MerchantName   *string     `json:"merchantName,omitempty"`
	OriginalName   *string     `json:"originalName,omitempty"`
	CategoryID     string      `json:"categoryId"`
	CategoryName   string      `json:"categoryName"`
	IsRecurring    bool        `json:"isRecurring,omitempty"`
	IsReviewed     bool        `json:"isReviewed"`
	Notes          *string     `json:"notes,omitempty"`
	Pending        bool        `json:"pending,omitempty"`
	IsHidden       bool        `json:"isHidden,omitempty"`
}

func mapTransaction(tx *model.Transaction) leanTransaction {
	return leanTransaction{
		ID:             tx.ID.EncodedString(),
		AccountID:      tx.Account.ID.EncodedString(),
		AccountName:    tx.Account.Name,
		Amount:         tx.Amount,
		Datetime:       tx.Datetime,
		PostedDatetime: tx.PostedDatetime,
		MerchantName:   tx.MerchantName,
		OriginalName:   tx.OriginalName,
		CategoryID:     tx.Category.ID.EncodedString(),
		CategoryName:   tx.Category.Name,
		IsRecurring:    tx.IsRecurring,
		IsReviewed:     tx.IsReviewed,
		Notes:          tx.Notes,
		Pending:        tx.Pending,
		IsHidden:       tx.IsHidden,
	}
}

type leanTransactionPayload struct {
	Transaction *leanTransaction `json:"transaction"`
}

func mapTransactionPayload(tx *model.Transaction) leanTransactionPayload {
	if tx == nil {
		return leanTransactionPayload{}
	}
	transaction := mapTransaction(tx)
	return leanTransactionPayload{Transaction: &transaction}
}

type leanBulkUpdateTransactionsPayload struct {
	UpdatedCount int32             `json:"updatedCount"`
	Transactions []leanTransaction `json:"transactions"`
}

func mapBulkUpdateTransactionsPayload(payload *model.BulkUpdateTransactionsPayload) *leanBulkUpdateTransactionsPayload {
	return &leanBulkUpdateTransactionsPayload{
		UpdatedCount: payload.UpdatedCount,
		Transactions: u.Map(payload.Transactions, mapTransaction),
	}
}

type leanTransactionConnection struct {
	Items      []leanTransaction `json:"items"`
	PageInfo   *model.PageInfo   `json:"pageInfo"`
	TotalCount int32             `json:"totalCount"`
}

func mapTransactionConnection(conn *model.TransactionConnection) *leanTransactionConnection {
	toTransaction := func(edge *model.TransactionEdge) leanTransaction {
		return mapTransaction(edge.Node)
	}
	return &leanTransactionConnection{
		Items:      u.Map(conn.Edges, toTransaction),
		PageInfo:   conn.PageInfo,
		TotalCount: conn.TotalCount,
	}
}
