package accountsdb

import (
	"tallyo/internal/database"
	"tallyo/internal/database/dbgen"
)

type Store struct {
	database.BaseStore
	q *dbgen.Queries
}

func New(db *database.DB) *Store {
	return &Store{BaseStore: database.NewBaseStore(db), q: dbgen.New(db.SQL())}
}
