package admin

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/samber/lo"

	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
)

type fakeStore struct {
	users   map[int64]*model.User
	emails  map[string]int64
	revoked string
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		users: map[int64]*model.User{
			1: {ID: model.New(model.GlobalIDUser, 1), Email: "admin@example.com", Role: model.RoleAdmin},
		},
		emails: map[string]int64{"admin@example.com": 1},
	}
}

func (f *fakeStore) Users(ctx context.Context) ([]*model.User, error) {
	return lo.Values(f.users), nil
}

func (f *fakeStore) UserByID(ctx context.Context, id int64) (*model.User, error) {
	user, ok := f.users[id]
	if !ok {
		return nil, fmt.Errorf("missing user")
	}
	return user, nil
}

func (f *fakeStore) UpdateUserRole(ctx context.Context, id int64, role string) (*model.User, error) {
	user, ok := f.users[id]
	if !ok {
		return nil, fmt.Errorf("missing user")
	}
	user.Role = model.RoleFromName(role)
	return user, nil
}

func (f *fakeStore) InsertUser(ctx context.Context, input InsertUserInput) (*model.User, error) {
	id := int64(len(f.users) + 1)
	user := &model.User{ID: model.New(model.GlobalIDUser, id), Email: input.Email, Role: model.RoleFromName(input.Role)}
	f.users[id] = user
	f.emails[input.Email] = id
	return user, nil
}

func (f *fakeStore) UserIDByEmail(ctx context.Context, email string) (int64, error) {
	id, ok := f.emails[email]
	if !ok {
		return 0, fmt.Errorf("missing email")
	}
	return id, nil
}

func (f *fakeStore) UserExists(ctx context.Context, email string) (bool, error) {
	_, ok := f.emails[email]
	return ok, nil
}

func (f *fakeStore) RemoveUser(ctx context.Context, id int64) error {
	user, ok := f.users[id]
	if !ok {
		return fmt.Errorf("missing user")
	}
	delete(f.users, id)
	delete(f.emails, user.Email)
	f.revoked = user.Email
	return nil
}

func (f *fakeStore) CreatePlaidCredential(context.Context, model.CreatePlaidCredentialInput) (*model.PlaidCredential, error) {
	return nil, nil
}

func (f *fakeStore) UpdatePlaidCredential(context.Context, model.UpdatePlaidCredentialInput) (*model.PlaidCredential, error) {
	return nil, nil
}

func (f *fakeStore) DeletePlaidCredential(context.Context, int32) (bool, error) { return false, nil }

func (f *fakeStore) PlaidCredentials(context.Context) ([]*model.PlaidCredential, error) {
	return nil, nil
}

func (f *fakeStore) PlaidCredentialsByIDs(context.Context, []int32) (map[int32]*model.PlaidCredential, error) {
	return nil, nil
}

type fakeRuntimeConfigStore struct{}

func (fakeRuntimeConfigStore) LoadSections(context.Context) (runtimeconfig.Sections, error) {
	return runtimeconfig.Sections{}, nil
}

func (fakeRuntimeConfigStore) SaveSections(context.Context, runtimeconfig.Patch) (runtimeconfig.Sections, error) {
	return runtimeconfig.Sections{}, nil
}

func (fakeRuntimeConfigStore) AdminPasskeyExists(context.Context) (bool, error) { return false, nil }

func newTestService(store Store) *Service {
	return NewService(store, runtimeconfig.New(fakeRuntimeConfigStore{}))
}

type fakeInviter struct {
	email     string
	role      string
	invitedBy string
}

func (f *fakeInviter) SendInvitation(ctx context.Context, email string, role string, invitedBy string) error {
	f.email = email
	f.role = role
	f.invitedBy = invitedBy
	return nil
}

func (f *fakeInviter) CreateInviteLink(ctx context.Context, email string, role string) (string, time.Time, error) {
	f.email = email
	f.role = role
	return "https://spend.example/invite", time.Now().UTC().Add(15 * time.Minute), nil
}

type failingInviter struct{ err error }

func (f failingInviter) SendInvitation(context.Context, string, string, string) error { return f.err }

func (f failingInviter) CreateInviteLink(context.Context, string, string) (string, time.Time, error) {
	return "", time.Time{}, f.err
}

func TestServiceUserManagement(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	inviter := &fakeInviter{}
	svc := newTestService(store)
	svc.Inviter = inviter

	users, err := svc.Users(ctx)
	if err != nil || len(users) != 1 {
		t.Fatalf("Users = %d, %v", len(users), err)
	}
	user, err := svc.AddUser(ctx, "friend@example.com", "admin@example.com", "writer")
	must.NoErr(t, err)
	if user.Email != "friend@example.com" || inviter.email != user.Email || inviter.role != "writer" || inviter.invitedBy != "admin@example.com" {
		t.Fatalf("unexpected add/invite result: user=%+v inviter=%+v", user, inviter)
	}
	if _, err := svc.AddUser(ctx, "friend@example.com", "admin@example.com", "writer"); err == nil {
		t.Fatalf("expected duplicate error")
	}

	updated, err := svc.UpdateUserRole(ctx, user.ID.Int64(), "readonly")
	if err != nil || updated.Role != model.RoleReadonly {
		t.Fatalf("UpdateUser = %+v, %v", updated, err)
	}
	adminUser, err := svc.UpdateUserRole(ctx, 1, "readonly")
	if err != nil || adminUser.Role != model.RoleReadonly {
		t.Fatalf("UpdateUser admin = %+v, %v", adminUser, err)
	}
	must.NoErr(t, svc.RemoveUser(ctx, user.ID.Int64()))
	if store.revoked != "friend@example.com" {
		t.Fatalf("revoked = %q", store.revoked)
	}
}

func TestServiceErrorPaths(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	svc := newTestService(store)

	user, err := svc.AddUser(ctx, "solo@example.com", "", "cashflow_tracker")
	must.NoErr(t, err)
	if user.Role != model.RoleCashflowTracker {
		t.Fatalf("user role = %s", user.Role)
	}
	if _, _, err := svc.CreateInviteLink(ctx, user.ID.Int64()); err == nil || err.Error() != "invitations are not configured" {
		t.Fatalf("CreateInviteLink() error = %v", err)
	}
	if _, err := svc.AddUser(ctx, "bad@example.com", "missing@example.com", "writer"); err == nil {
		t.Fatalf("expected missing inviter error")
	}
	if _, err := svc.UpdateUserRole(ctx, 999, "writer"); err == nil {
		t.Fatalf("expected missing update user error")
	}
	if err := svc.RemoveUser(ctx, 999); err == nil {
		t.Fatalf("expected missing remove user error")
	}
}

func TestAddUserCompensatesFailedInvitation(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	svc := newTestService(store)
	svc.Inviter = failingInviter{err: fmt.Errorf("smtp unreachable")}

	if _, err := svc.AddUser(ctx, "friend@example.com", "", "writer"); err == nil {
		t.Fatal("expected send-invitation error")
	}
	if exists, err := store.UserExists(ctx, "friend@example.com"); err != nil || exists {
		t.Fatalf("UserExists after failed invitation = %v, %v; want false", exists, err)
	}
	if store.revoked != "friend@example.com" {
		t.Fatalf("revoked = %q", store.revoked)
	}
}

type removeFailingStore struct {
	*fakeStore
}

func (s removeFailingStore) RemoveUser(context.Context, int64) error {
	return fmt.Errorf("db unavailable")
}

func TestAddUserReportsBothErrorsWhenCompensatingDeleteFails(t *testing.T) {
	ctx := context.Background()
	store := removeFailingStore{fakeStore: newFakeStore()}
	svc := newTestService(store)
	svc.Inviter = failingInviter{err: fmt.Errorf("smtp unreachable")}

	_, err := svc.AddUser(ctx, "friend@example.com", "", "writer")
	if err == nil {
		t.Fatal("expected send-invitation error")
	}
	if got := err.Error(); got != "send invitation: smtp unreachable (compensating delete also failed: db unavailable)" {
		t.Fatalf("combined error = %q", got)
	}
	if exists, err := store.UserExists(ctx, "friend@example.com"); err != nil || !exists {
		t.Fatalf("UserExists after failed compensating delete = %v, %v; want true", exists, err)
	}
}
