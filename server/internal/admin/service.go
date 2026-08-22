package admin

import (
	"context"
	"fmt"
	"time"

	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
)

type Service struct {
	Store
	Inviter Inviter
	*runtimeconfig.Manager
}

type disabledInviter struct{}

func (disabledInviter) SendInvitation(context.Context, string, string, string) error { return nil }

func (disabledInviter) CreateInviteLink(context.Context, string, string) (string, time.Time, error) {
	return "", time.Time{}, apierror.Publicf("invitations are not configured")
}

// NewService returns an admin service with invitations disabled.
func NewService(store Store, cfg *runtimeconfig.Manager) *Service {
	return &Service{Store: store, Inviter: disabledInviter{}, Manager: cfg}
}

func (s *Service) AddUser(ctx context.Context, email, invitedBy string, role string) (*model.User, error) {
	exists, err := s.UserExists(ctx, email)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, apierror.Publicf("user already exists")
	}

	var inviterID int64
	if invitedBy != "" {
		inviterID, err = s.UserIDByEmail(ctx, invitedBy)
		if err != nil {
			return nil, fmt.Errorf("lookup inviter: %w", err)
		}
	}

	user, err := s.InsertUser(ctx, InsertUserInput{Email: email, InvitedByID: inviterID, Role: role})
	if err != nil {
		return nil, err
	}
	if err := s.Inviter.SendInvitation(ctx, email, role, invitedBy); err != nil {
		if delErr := s.RemoveUser(ctx, user.ID.Int64()); delErr != nil {
			return nil, fmt.Errorf("send invitation: %w (compensating delete also failed: %w)", err, delErr)
		}
		return nil, fmt.Errorf("send invitation: %w", err)
	}
	return user, nil
}

func (s *Service) CreateInviteLink(ctx context.Context, userID int64) (string, time.Time, error) {
	user, err := s.UserByID(ctx, userID)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("lookup user: %w", err)
	}
	return s.Inviter.CreateInviteLink(ctx, user.Email, model.RoleName(user.Role))
}
