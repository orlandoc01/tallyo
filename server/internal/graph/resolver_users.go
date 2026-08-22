package graph

import (
	"context"
	"strings"

	"tallyo/internal/apierror"
	"tallyo/internal/auth"
	"tallyo/internal/graph/model"
)

func (r *Resolver) GetUsers(ctx context.Context) (*model.UserList, error) {
	return listResult(ctx, r.Admin.Users, func(items []*model.User) *model.UserList { return &model.UserList{Items: items} })
}

func (r *Resolver) AddUser(ctx context.Context, input model.AddUserInput) (*model.AddUserPayload, error) {
	adminEmail, _ := auth.Subject(ctx)
	email := strings.ToLower(strings.TrimSpace(input.Email))
	if email == "" {
		return nil, apierror.Publicf("email is required")
	}
	role := fromModelRole(input.Role)
	user, err := r.Admin.AddUser(ctx, email, adminEmail, role)
	if err != nil {
		return nil, err
	}
	return &model.AddUserPayload{User: user}, nil
}

func (r *Resolver) CreateInviteLink(ctx context.Context, input model.CreateInviteLinkInput) (*model.CreateInviteLinkPayload, error) {
	id, err := input.UserID.Int64OfType(model.GlobalIDUser)
	if err != nil {
		return nil, err
	}
	url, expiresAt, err := r.Admin.CreateInviteLink(ctx, id)
	if err != nil {
		return nil, err
	}
	return &model.CreateInviteLinkPayload{URL: url, ExpiresAt: expiresAt}, nil
}

func (r *Resolver) RemoveUser(ctx context.Context, input model.RemoveUserInput) (*model.RemoveUserPayload, error) {
	id, err := input.ID.Int64OfType(model.GlobalIDUser)
	if err != nil {
		return nil, err
	}
	if err := r.Admin.RemoveUser(ctx, id); err != nil {
		return nil, err
	}
	return &model.RemoveUserPayload{Success: true}, nil
}

func (r *Resolver) UpdateUser(ctx context.Context, input model.UpdateUserInput) (*model.UpdateUserPayload, error) {
	id, err := input.ID.Int64OfType(model.GlobalIDUser)
	if err != nil {
		return nil, err
	}
	user, err := r.Admin.UpdateUserRole(ctx, id, model.RoleName(input.Role))
	if err != nil {
		return nil, err
	}
	return &model.UpdateUserPayload{User: user}, nil
}

func fromModelRole(r *model.Role) string {
	if r == nil {
		return model.DefaultRoleName
	}
	return model.RoleName(*r)
}
