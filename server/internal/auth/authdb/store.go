package authdb

import (
	"context"
	"database/sql"
	"fmt"

	"tallyo/internal/database"
	"tallyo/internal/database/dbgen"

	"github.com/samber/lo"
)

type Store struct {
	db *database.DB
	q  *dbgen.Queries
}

type txContextKey struct{}

type txAwareDB struct {
	base *sql.DB
}

func New(db *database.DB) *Store {
	return &Store{db: db, q: dbgen.New(txAwareDB{base: db.SQL()})}
}

func (db txAwareDB) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return db.dbtx(ctx).ExecContext(ctx, query, args...)
}

func (db txAwareDB) PrepareContext(ctx context.Context, query string) (*sql.Stmt, error) {
	return db.dbtx(ctx).PrepareContext(ctx, query)
}

func (db txAwareDB) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return db.dbtx(ctx).QueryContext(ctx, query, args...)
}

func (db txAwareDB) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return db.dbtx(ctx).QueryRowContext(ctx, query, args...)
}

func (db txAwareDB) dbtx(ctx context.Context) dbgen.DBTX {
	tx, ok := txFromContext(ctx)
	return lo.Ternary[dbgen.DBTX](ok, tx, db.base)
}

func (s *Store) BeginTX(ctx context.Context) (context.Context, error) {
	if _, ok := txFromContext(ctx); ok {
		return nil, fmt.Errorf("auth transaction already active")
	}
	tx, err := s.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin auth transaction: %w", err)
	}
	return context.WithValue(ctx, txContextKey{}, tx), nil
}

func (s *Store) Commit(ctx context.Context) error {
	tx, ok := txFromContext(ctx)
	if !ok {
		return fmt.Errorf("missing auth transaction")
	}
	return tx.Commit()
}

func (s *Store) Rollback(ctx context.Context) error {
	tx, ok := txFromContext(ctx)
	if !ok {
		return fmt.Errorf("missing auth transaction")
	}
	return tx.Rollback()
}

func txFromContext(ctx context.Context) (*sql.Tx, bool) {
	tx, ok := ctx.Value(txContextKey{}).(*sql.Tx)
	return tx, ok && tx != nil
}

func wrapDB(err error, op string) error {
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

func wrapAffectedRows(err error, rows int64, op string) error {
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}
