package wealth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"time"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
)

const defaultAccountSnapshotLimit int32 = 20
const maxAccountSnapshotLimit int32 = 100

type accountSnapshotCursor struct {
	Date string `json:"date"`
}

func (s *Service) AccountSnapshots(
	ctx context.Context,
	input model.AccountSnapshotsInput,
) (*model.AccountSnapshotConnection, error) {
	accountID := input.AccountID.Int64()
	limit, err := accountSnapshotLimit(input.First)
	if err != nil {
		return nil, err
	}
	afterDate, err := accountSnapshotAfterDate(input.After)
	if err != nil {
		return nil, err
	}
	rows, err := s.Store.AccountBalanceSnapshotsPage(ctx, accountID, afterDate, int64(limit)+1)
	if err != nil {
		return nil, err
	}
	total, err := s.Store.AccountBalanceSnapshotDayCount(ctx, accountID)
	if err != nil {
		return nil, err
	}
	hasNextPage := len(rows) > int(limit)
	if hasNextPage {
		rows = rows[:int(limit)]
	}
	return s.accountSnapshotConnection(ctx, rows, int32(total), hasNextPage, input.After != nil)
}

func accountSnapshotLimit(first *int32) (int32, error) {
	if first == nil {
		return defaultAccountSnapshotLimit, nil
	}
	if *first <= 0 {
		return 0, apierror.Publicf("first must be positive")
	}
	if *first > maxAccountSnapshotLimit {
		return 0, apierror.Publicf("first must not exceed %d", maxAccountSnapshotLimit)
	}
	return *first, nil
}

func accountSnapshotAfterDate(after *string) (*string, error) {
	if after == nil {
		return nil, nil
	}
	cursor, err := decodeAccountSnapshotCursor(*after)
	if err != nil {
		return nil, err
	}
	return &cursor.Date, nil
}

func (s *Service) accountSnapshotConnection(
	ctx context.Context,
	rows []*SnapshotRow,
	total int32,
	hasNextPage bool,
	hasPreviousPage bool,
) (*model.AccountSnapshotConnection, error) {
	if len(rows) == 0 {
		return &model.AccountSnapshotConnection{
			Edges:      []*model.AccountSnapshotEdge{},
			PageInfo:   &model.PageInfo{HasNextPage: hasNextPage, HasPreviousPage: hasPreviousPage},
			TotalCount: total,
		}, nil
	}
	snapshotIDs := u.Map(rows, func(row *SnapshotRow) int64 { return row.ID })
	holdingsBySnapshotID, err := s.Store.SnapshotHoldingsBySnapshotIDs(ctx, snapshotIDs)
	if err != nil {
		return nil, err
	}
	toEdge := func(row *SnapshotRow) (*model.AccountSnapshotEdge, error) {
		node, err := s.accountSnapshotModelFromParts(ctx, row, holdingsBySnapshotID[row.ID], row.AccountType)
		if err != nil {
			return nil, err
		}
		return &model.AccountSnapshotEdge{Node: node, Cursor: encodeAccountSnapshotCursor(row.Date)}, nil
	}
	edges, err := u.MapErr(rows, toEdge)
	if err != nil {
		return nil, err
	}
	pageInfo := &model.PageInfo{HasNextPage: hasNextPage, HasPreviousPage: hasPreviousPage}
	if len(edges) > 0 {
		pageInfo.StartCursor = &edges[0].Cursor
		pageInfo.EndCursor = &edges[len(edges)-1].Cursor
	}
	return &model.AccountSnapshotConnection{Edges: edges, PageInfo: pageInfo, TotalCount: total}, nil
}

func encodeAccountSnapshotCursor(date string) string {
	b, _ := json.Marshal(accountSnapshotCursor{Date: date})
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeAccountSnapshotCursor(cursor string) (accountSnapshotCursor, error) {
	b, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return accountSnapshotCursor{}, invalidSnapshotCursorError()
	}
	var c accountSnapshotCursor
	if err := json.Unmarshal(b, &c); err != nil {
		return accountSnapshotCursor{}, invalidSnapshotCursorError()
	}
	if _, err := time.Parse(time.DateOnly, c.Date); err != nil {
		return accountSnapshotCursor{}, invalidSnapshotCursorError()
	}
	return c, nil
}

func invalidSnapshotCursorError() error {
	return apierror.Publicf("invalid cursor")
}
