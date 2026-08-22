package admin

import (
	"context"
	"time"

	"tallyo/internal/graph/model"
)

type InsertUserInput struct {
	Email       string
	InvitedByID int64
	Role        string
}

type userStore interface {
	Users(ctx context.Context) ([]*model.User, error)
	UserByID(ctx context.Context, id int64) (*model.User, error)
	UpdateUserRole(ctx context.Context, id int64, role string) (*model.User, error)
	InsertUser(ctx context.Context, input InsertUserInput) (*model.User, error)
	UserIDByEmail(ctx context.Context, email string) (int64, error)
	UserExists(ctx context.Context, email string) (bool, error)
	RemoveUser(ctx context.Context, id int64) error
}

type plaidCredentialStore interface {
	CreatePlaidCredential(ctx context.Context, input model.CreatePlaidCredentialInput) (*model.PlaidCredential, error)
	UpdatePlaidCredential(ctx context.Context, input model.UpdatePlaidCredentialInput) (*model.PlaidCredential, error)
	DeletePlaidCredential(ctx context.Context, id int32) (bool, error)
	PlaidCredentials(ctx context.Context) ([]*model.PlaidCredential, error)
	PlaidCredentialsByIDs(ctx context.Context, ids []int32) (map[int32]*model.PlaidCredential, error)
}

type Store interface {
	userStore
	plaidCredentialStore
}

type Inviter interface {
	SendInvitation(ctx context.Context, email string, role string, invitedBy string) error
	CreateInviteLink(ctx context.Context, email string, role string) (string, time.Time, error)
}
