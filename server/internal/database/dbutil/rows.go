package dbutil

import (
	"database/sql"
	"errors"

	"github.com/samber/lo"

	u "tallyo/internal/utils"
)

// MapRow adapts a single-row sqlc result, treating a missing row as a zero value.
func MapRow[R, T any](row R, err error, mapper func(R) T) (T, error) {
	var zero T
	if errors.Is(err, sql.ErrNoRows) {
		return zero, nil
	}
	if err != nil {
		return zero, err
	}
	return mapper(row), nil
}

// MapRows adapts a multi-row sqlc result.
func MapRows[R, T any](rows []R, err error, mapper func(R) T) ([]T, error) {
	if err != nil {
		return nil, err
	}
	return u.Map(rows, mapper), nil
}

func RowsAffected(rows int64, err error) (bool, error) {
	return err == nil && rows > 0, err
}

func MapSingle[K comparable, V any](values map[K]V, err error, key K) (V, error) {
	var zero V
	return lo.Ternary(err != nil, zero, values[key]), err
}

// MapFirstRow adapts an optional multi-row sqlc result, mapping only the first row.
func MapFirstRow[R, T any](rows []R, err error, mapper func(R) T) (T, error) {
	var zero T
	if err != nil {
		return zero, err
	}
	if len(rows) == 0 {
		return zero, nil
	}
	return mapper(rows[0]), nil
}

// FirstRow returns the first row or sql.ErrNoRows when the query had no results.
func FirstRow[R any](rows []R, err error) (R, error) {
	var zero R
	if err != nil {
		return zero, err
	}
	if len(rows) == 0 {
		return zero, sql.ErrNoRows
	}
	return rows[0], nil
}

// AssociateRows adapts a multi-row sqlc result into a map.
func AssociateRows[R any, K comparable, V any](rows []R, err error, kv func(R) (K, V)) (map[K]V, error) {
	if err != nil {
		return nil, err
	}
	return lo.Associate(rows, kv), nil
}

// GroupRows adapts a multi-row sqlc result into grouped values.
func GroupRows[R any, K comparable, V any](rows []R, err error, kv func(R) (K, V)) (map[K][]V, error) {
	if err != nil {
		return nil, err
	}
	return lo.GroupByMap(rows, kv), nil
}
