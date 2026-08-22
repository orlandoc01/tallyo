package auth

import (
	"context"
	"time"
)

func (s *Store) CreateAuthCode(ctx context.Context, code string, auth AuthCode) error {
	return s.db.CreateAuthCode(ctx, tokenSignature(code), auth)
}

func (s *Store) CleanupExpired(ctx context.Context) error {
	return s.db.CleanupExpiredAuth(ctx, time.Now().UTC())
}
