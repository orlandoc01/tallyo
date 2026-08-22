package db

import (
	"context"
	"database/sql"
	"fmt"

	"tallyo/internal/admin"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"

	"github.com/samber/lo"
)

func (s *Store) Users(ctx context.Context) ([]*model.User, error) {
	rows, err := s.q.Users(ctx, dbgen.UsersParams{})
	return dbutil.MapRows(rows, err, userFromRow)
}

func (s *Store) UserByID(ctx context.Context, id int64) (*model.User, error) {
	rows, err := s.q.Users(ctx, dbgen.UsersParams{ID: &id})
	row, err := dbutil.FirstRow(rows, err)
	if err != nil {
		return nil, err
	}
	return userFromRow(row), nil
}

func (s *Store) UpdateUserRole(ctx context.Context, id int64, role string) (*model.User, error) {
	if err := s.q.UpdateUserRole(ctx, dbgen.UpdateUserRoleParams{Role: role, ID: id}); err != nil {
		return nil, fmt.Errorf("update user role: %w", err)
	}
	rows, err := s.q.Users(ctx, dbgen.UsersParams{ID: &id})
	row, err := dbutil.FirstRow(rows, err)
	if err != nil {
		return nil, fmt.Errorf("find updated user: %w", err)
	}
	return userFromRow(row), nil
}

func (s *Store) InsertUser(ctx context.Context, input admin.InsertUserInput) (*model.User, error) {
	invitedBy := lo.EmptyableToPtr(input.InvitedByID)
	id, err := s.q.InsertUser(ctx, dbgen.InsertUserParams{Email: input.Email, Role: input.Role, InvitedBy: invitedBy})
	if err != nil {
		return nil, fmt.Errorf("insert user: %w", err)
	}
	return s.UserByID(ctx, id)
}

func (s *Store) UserIDByEmail(ctx context.Context, email string) (int64, error) {
	rows, err := s.q.Users(ctx, dbgen.UsersParams{Email: &email})
	row, err := dbutil.FirstRow(rows, err)
	return row.ID, err
}

func userExists(dbgen.UsersRow) bool { return true }

func (s *Store) UserExists(ctx context.Context, email string) (bool, error) {
	rows, err := s.q.Users(ctx, dbgen.UsersParams{Email: &email})
	return dbutil.MapFirstRow(rows, err, userExists)
}

func (s *Store) RemoveUser(ctx context.Context, id int64) error {
	return s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		rows, err := q.Users(ctx, dbgen.UsersParams{ID: &id})
		row, err := dbutil.FirstRow(rows, err)
		if err != nil {
			return fmt.Errorf("lookup user: %w", err)
		}
		if err := q.DeleteUser(ctx, dbgen.DeleteUserParams{ID: id}); err != nil {
			return fmt.Errorf("delete user: %w", err)
		}
		if err := q.DeleteAccessTokensBySubject(ctx, dbgen.DeleteAccessTokensBySubjectParams{Subject: row.Email}); err != nil {
			return fmt.Errorf("revoke access tokens: %w", err)
		}
		if err := q.DeleteRefreshTokensBySubject(ctx, dbgen.DeleteRefreshTokensBySubjectParams{Subject: row.Email}); err != nil {
			return fmt.Errorf("revoke refresh tokens: %w", err)
		}
		return nil
	})
}

func userFromRow(row dbgen.UsersRow) *model.User {
	return &model.User{
		ID:        model.New(model.GlobalIDUser, row.ID),
		Email:     row.Email,
		Role:      model.RoleFromName(row.Role),
		CreatedAt: row.CreatedAt,
	}
}
