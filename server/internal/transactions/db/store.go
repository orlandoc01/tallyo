package transactionsdb

import (
	"database/sql"

	"tallyo/internal/database"
	"tallyo/internal/database/dbgen"
)

const UncategorizedCategoryID int64 = 0

type Store struct {
	database.BaseStore
	db *database.DB
	q  *dbgen.Queries
}

func New(db *database.DB) *Store {
	return &Store{BaseStore: database.NewBaseStore(db), db: db, q: dbgen.New(db.SQL())}
}

func (s *Store) SQL() *sql.DB { return s.db.SQL() }
