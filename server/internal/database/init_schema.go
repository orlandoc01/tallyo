package database

import (
	"context"
	"fmt"
)

func (s *DB) initSchema(ctx context.Context) error {
	if err := s.runMigrations(ctx); err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}
	if err := s.seedReferenceCategories(ctx); err != nil {
		return fmt.Errorf("seed reference categories: %w", err)
	}
	return nil
}
