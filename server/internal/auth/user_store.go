package auth

import (
	"context"
	"fmt"
	"slices"
)

func (s *Store) IsEmailAllowed(ctx context.Context, email string) (bool, error) {
	return s.db.IsEmailAllowed(ctx, email)
}

func (s *Store) UserRole(ctx context.Context, email string) (Role, error) {
	role, err := s.db.UserRole(ctx, email)
	if err != nil {
		return "", err
	}
	parsed := Role(role)
	if !slices.Contains(validRoles, parsed) {
		return "", fmt.Errorf("unknown role %q for user %q", role, email)
	}
	return parsed, nil
}

func (s *Store) UserExists(ctx context.Context, email string) (bool, error) {
	return s.db.UserExists(ctx, email)
}

func (s *Store) RevokeUserTokens(ctx context.Context, email string) error {
	return s.db.RevokeUserTokens(ctx, email)
}
