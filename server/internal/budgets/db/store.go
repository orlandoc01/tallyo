package budgetsdb

import (
	"tallyo/internal/budgets"
	"tallyo/internal/database"
	"tallyo/internal/database/dbgen"
)

var _ budgets.Store = (*Store)(nil)

type Store struct {
	q *dbgen.Queries
}

func New(db *database.DB) *Store {
	return &Store{q: dbgen.New(db.SQL())}
}
