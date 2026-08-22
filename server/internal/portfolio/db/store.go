package portfoliodb

import (
	"tallyo/internal/database"
	"tallyo/internal/database/dbgen"
)

type Store struct {
	q *dbgen.Queries
}

func New(db *database.DB) *Store {
	return &Store{q: dbgen.New(db.SQL())}
}
