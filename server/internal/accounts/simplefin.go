package accounts

import (
	"context"
	"fmt"
	"log/slog"

	"tallyo/internal/apierror"
	"tallyo/internal/clients"
	"tallyo/internal/graph/model"

	"github.com/samber/lo"
)

// SimpleFinLinkStore is the subset of Store methods required by SimpleFinService.
type SimpleFinLinkStore interface {
	OwnerByID(ctx context.Context, id int64) (*model.Owner, error)
	CreateSimpleFinAccessToken(ctx context.Context, accessURL string, ownerID int64, label string) (*model.SimpleFinAccessToken, error)
	SimpleFinAccessTokenByID(ctx context.Context, id int64) (*model.SimpleFinAccessToken, error)
	LinkSimpleFinConnection(ctx context.Context, conn UpsertSimpleFinConnectionParams) (simpleFinConnID int64, connectionID int64, err error)
	SimpleFinConnectionsByTokenIDs(ctx context.Context, accessTokenIDs []int64) (map[int64][]*model.SimpleFinConnection, error)
	UpsertAccountWithExternalID(ctx context.Context, externalID string, account *model.Account) (int64, error)
	ResetSimpleFinTokenSyncedAt(ctx context.Context, id int64) error
	DeleteSimpleFinAccessToken(ctx context.Context, id int64) error
}

type SimpleFinService struct {
	Store  SimpleFinLinkStore
	Client clients.SimpleFinClient
	Events Publisher
	Log    *slog.Logger
}

// CreateAccessToken claims a setup token, persists the access URL, fetches
// connections/accounts, and publishes AccountsCreated events.
func (s *SimpleFinService) CreateAccessToken(
	ctx context.Context,
	setupToken string,
	ownerID int64,
	label string,
) (*model.CreateSimpleFinAccessTokenPayload, error) {
	owner, err := s.ownerByID(ctx, ownerID)
	if err != nil {
		return nil, err
	}

	accessURL, err := s.Client.Claim(ctx, setupToken)
	if err != nil {
		return nil, fmt.Errorf("claim setup token: %w", err)
	}

	token, err := s.Store.CreateSimpleFinAccessToken(ctx, accessURL, ownerID, label)
	if err != nil {
		return nil, fmt.Errorf("persist access token: %w", err)
	}
	token.Owner = owner

	tokenID := token.ID.Int64()

	accountSet, err := s.Client.GetAccounts(ctx, accessURL, clients.GetAccountsOpts{Pending: true})
	if err != nil {
		s.Log.Warn("initial simplefin fetch failed; token saved but no accounts yet", "error", err)
		return &model.CreateSimpleFinAccessTokenPayload{
			AccessToken: token,
			Connections: []*model.SimpleFinConnection{},
			Accounts:    []*model.Account{},
		}, nil
	}

	connectionIDByExternalConnID := make(map[string]int64, len(accountSet.Connections))
	connectionIDBySimpleFinConnID := make(map[int64]int64, len(accountSet.Connections))

	for _, sfConn := range accountSet.Connections {
		params := NewUpsertSimpleFinConnectionParams(tokenID, ownerID, sfConn)
		simpleFinConnID, connectionID, err := s.Store.LinkSimpleFinConnection(ctx, params)
		if err != nil {
			return nil, fmt.Errorf("link simplefin connection %s: %w", sfConn.ConnID, err)
		}
		connectionIDByExternalConnID[sfConn.ConnID] = connectionID
		connectionIDBySimpleFinConnID[simpleFinConnID] = connectionID
	}

	for _, sfAccount := range accountSet.Accounts {
		connectionID, ok := connectionIDByExternalConnID[sfAccount.ConnID]
		if !ok {
			s.Log.Warn("skipping simplefin account: connection not found", "conn_id", sfAccount.ConnID)
			continue
		}

		fields := FieldsFromSimpleFinAccount(sfAccount)
		account := &model.Account{
			Connection:  &model.Connection{ID: model.New(model.GlobalIDConnection, connectionID)},
			Owner:       owner,
			Name:        fields.Name,
			Type:        fields.Type,
			Mask:        fields.Mask,
			NeedsReview: fields.NeedsReview,
			Manual:      false,
		}
		if _, err := s.Store.UpsertAccountWithExternalID(ctx, fields.ID, account); err != nil {
			return nil, fmt.Errorf("upsert account %s: %w", fields.ID, err)
		}
	}

	connectionsByToken, err := s.Store.SimpleFinConnectionsByTokenIDs(ctx, []int64{tokenID})
	if err != nil {
		return nil, fmt.Errorf("fetch simplefin connections: %w", err)
	}
	connections := connectionsByToken[tokenID]
	if len(connections) > 0 {
		conn := connections[0]
		s.Events.Publish(AccountsCreated{
			ConnectionID: connectionIDBySimpleFinConnID[conn.ID.Int64()],
			Provider:     SourceTableSimpleFinConnection,
			SourceID:     conn.ID.Int64(),
		})
	}
	toAccounts := func(conn *model.SimpleFinConnection, _ int) []*model.Account { return conn.Accounts }
	allAccounts := lo.FlatMap(connections, toAccounts)

	return &model.CreateSimpleFinAccessTokenPayload{
		AccessToken: token,
		Connections: connections,
		Accounts:    allAccounts,
	}, nil
}

// DeleteAccessToken removes the access token and all dependent data.
func (s *SimpleFinService) DeleteAccessToken(ctx context.Context, id int64) error {
	return s.Store.DeleteSimpleFinAccessToken(ctx, id)
}

// ResetSync clears last_synced_at to force a full re-pull on the next tick.
func (s *SimpleFinService) ResetSync(ctx context.Context, id int64) (*model.SimpleFinAccessToken, error) {
	if err := s.Store.ResetSimpleFinTokenSyncedAt(ctx, id); err != nil {
		return nil, fmt.Errorf("reset simplefin sync: %w", err)
	}
	return s.Store.SimpleFinAccessTokenByID(ctx, id)
}

func (s *SimpleFinService) ownerByID(ctx context.Context, ownerID int64) (*model.Owner, error) {
	owner, err := s.Store.OwnerByID(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("lookup owner: %w", err)
	}
	if owner == nil {
		return nil, apierror.Publicf("invalid owner id %d", ownerID)
	}
	return owner, nil
}
