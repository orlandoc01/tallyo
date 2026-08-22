package transactionsdb

import (
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/samber/lo"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"
	u "tallyo/internal/utils"
)

func EncodeCursor(t *model.Transaction) string {
	b, _ := json.Marshal(transactions.Cursor{Datetime: dateTimeSQLArg(t.Datetime), ID: t.ID.Int64(), Amount: t.Amount})
	return base64.RawURLEncoding.EncodeToString(b)
}

func DecodeCursor(cursor string) (transactions.Cursor, error) {
	b, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return transactions.Cursor{}, invalidCursorError()
	}
	var c transactions.Cursor
	if err := json.Unmarshal(b, &c); err != nil {
		return transactions.Cursor{}, invalidCursorError()
	}
	if _, err := time.Parse(time.RFC3339, c.Datetime); err != nil {
		return transactions.Cursor{}, invalidCursorError()
	}
	if c.ID <= 0 {
		return transactions.Cursor{}, invalidCursorError()
	}
	return c, nil
}

func invalidCursorError() error {
	return apierror.Publicf("invalid cursor")
}

func dateTimeSQLArg(dt time.Time) string {
	return dt.UTC().Format(time.RFC3339)
}

func transactionConnection(transactions []*model.Transaction, total int32, hasMore bool, query transactions.TransactionQuery) *model.TransactionConnection {
	toEdge := func(transaction *model.Transaction) *model.TransactionEdge {
		return &model.TransactionEdge{Node: transaction, Cursor: EncodeCursor(transaction)}
	}
	edges := u.Map(transactions, toEdge)
	backward := query.Last != nil
	pageInfo := &model.PageInfo{
		HasNextPage:     lo.Ternary(backward, query.Before != nil, hasMore),
		HasPreviousPage: lo.Ternary(backward, hasMore, query.After != nil),
	}
	if len(edges) > 0 {
		pageInfo.StartCursor = &edges[0].Cursor
		pageInfo.EndCursor = &edges[len(edges)-1].Cursor
	}
	return &model.TransactionConnection{Edges: edges, PageInfo: pageInfo, TotalCount: total}
}
