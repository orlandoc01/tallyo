package db

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"tallyo/internal/admin"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	return New(dbtest.Open(t))
}

func TestStoreHelpers(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	for input, want := range map[string]model.Role{
		"admin":             model.RoleAdmin,
		"readonly":          model.RoleReadonly,
		"spend_tracker":     model.RoleSpendTracker,
		"cashflow_tracker":  model.RoleCashflowTracker,
		"net_worth_tracker": model.RoleNetWorthTracker,
		"portfolio_tracker": model.RolePortfolioTracker,
		"writer":            model.RoleWriter,
	} {
		if got := model.RoleFromName(input); got != want {
			t.Fatalf("RoleFromName(%q) = %s, want %s", input, got, want)
		}
	}
	must.NoErr(t, store.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		_, err := q.InsertUser(ctx, dbgen.InsertUserParams{Email: "tx@example.com", Role: "admin"})
		return err
	}))
	if exists, err := store.UserExists(ctx, "tx@example.com"); err != nil || !exists {
		t.Fatalf("WithTx user exists = %v, %v", exists, err)
	}
}

func TestUserStoreCRUD(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	adminID, err := store.q.InsertUser(ctx, dbgen.InsertUserParams{Email: "admin@example.com", Role: "admin"})
	must.NoErr(t, err)
	user, err := store.InsertUser(ctx, admin.InsertUserInput{Email: "user@example.com", InvitedByID: adminID, Role: "writer"})
	if err != nil || user.Role != model.RoleWriter {
		t.Fatalf("InsertUser = %+v, %v", user, err)
	}
	userID := user.ID.Int64()
	updated, err := store.UpdateUserRole(ctx, userID, "readonly")
	if err != nil || updated.Role != model.RoleReadonly {
		t.Fatalf("UpdateUserRole = %+v, %v", updated, err)
	}
	users, err := store.Users(ctx)
	if err != nil || len(users) != 2 {
		t.Fatalf("Users = %d, %v", len(users), err)
	}
	id, err := store.UserIDByEmail(ctx, "user@example.com")
	if err != nil || id != userID {
		t.Fatalf("UserIDByEmail = %d, %v", id, err)
	}
	exists, err := store.UserExists(ctx, "user@example.com")
	if err != nil || !exists {
		t.Fatalf("UserExists = %v, %v", exists, err)
	}

	must.NoErr(t, store.q.CreateAccessToken(ctx, dbgen.CreateAccessTokenParams{
		Signature: "user-access", ClientID: "client", Subject: "user@example.com", ExpiresAt: time.Now().Add(time.Hour),
	}))
	must.NoErr(t, store.q.CreateRefreshToken(ctx, dbgen.CreateRefreshTokenParams{
		Signature: "user-refresh", ClientID: "client", Subject: "user@example.com", ExpiresAt: time.Now().Add(time.Hour),
	}))

	must.NoErr(t, store.RemoveUser(ctx, userID))
	exists, err = store.UserExists(ctx, "user@example.com")
	if err != nil || exists {
		t.Fatalf("deleted UserExists = %v, %v", exists, err)
	}
	if count := tokenCount(t, store, "oauth_access_tokens", "user@example.com"); count != 0 {
		t.Fatalf("access tokens after RemoveUser = %d, want 0", count)
	}
	if count := tokenCount(t, store, "oauth_refresh_tokens", "user@example.com"); count != 0 {
		t.Fatalf("refresh tokens after RemoveUser = %d, want 0", count)
	}

	if err := store.RemoveUser(ctx, 999999); err == nil {
		t.Fatal("expected error removing nonexistent user")
	}
}

func tokenCount(t *testing.T, store *Store, table, subject string) int {
	t.Helper()
	var count int
	must.NoErr(t, store.WithTx(context.Background(), func(tx *sql.Tx, _ *dbgen.Queries) error {
		return tx.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE subject = ?`, subject).Scan(&count)
	}))
	return count
}
