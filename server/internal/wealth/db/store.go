package wealthdb

import (
	"log/slog"

	"tallyo/internal/database"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/utils/nooplog"
	"tallyo/internal/wealth"
)

var _ wealth.ServiceStore = (*Store)(nil)
var _ wealth.SnapshotEditStore = (*Store)(nil)

type Store struct {
	database.BaseStore
	db  *database.DB
	q   *dbgen.Queries
	Log *slog.Logger
}

type Option func(*Store)

func WithLogger(log *slog.Logger) Option {
	return func(s *Store) { s.Log = log }
}

func New(db *database.DB, opts ...Option) *Store {
	s := &Store{
		BaseStore: database.NewBaseStore(db),
		db:        db,
		q:         dbgen.New(db.SQL()),
		Log:       nooplog.Logger,
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}
