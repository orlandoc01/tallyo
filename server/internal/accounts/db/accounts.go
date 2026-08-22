package accountsdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"tallyo/internal/accounts"
	"tallyo/internal/apierror"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"

	"github.com/samber/lo"
)

func (s *Store) Accounts(ctx context.Context) ([]*model.Account, error) {
	rows, err := s.q.AccountRecords(ctx, dbgen.AccountRecordsParams{})
	return dbutil.MapRows(rows, err, accountFromRecordRow)
}

func (s *Store) AccountsByItem(ctx context.Context, itemID int64) ([]*model.Account, error) {
	rows, err := s.q.AccountRecords(ctx, dbgen.AccountRecordsParams{ItemID: &itemID})
	return dbutil.MapRows(rows, err, accountFromRecordRow)
}

func (s *Store) SyncableAccountExternalIDsByItem(ctx context.Context, itemID int64) ([]string, error) {
	rows, err := s.q.AccountRecords(ctx, dbgen.AccountRecordsParams{ItemID: &itemID})
	toExternalID := func(row dbgen.AccountRecordsRow, _ int) (string, bool) {
		account := row.Account
		return account.ExternalID, !account.Manual && !account.IsClosed
	}
	return lo.FilterMap(rows, toExternalID), err
}

func (s *Store) AccountsByIDs(ctx context.Context, ids []int64) (map[int64]*model.Account, error) {
	if len(ids) == 0 {
		return map[int64]*model.Account{}, nil
	}
	rows, err := s.q.AccountRecords(ctx, dbgen.AccountRecordsParams{Ids: ids})
	toAccount := func(row dbgen.AccountRecordsRow) (int64, *model.Account) {
		return row.Account.ID, AccountFromRow(row.Account, row.OwnerName)
	}
	return dbutil.AssociateRows(rows, err, toAccount)
}

func (s *Store) AccountsByItems(ctx context.Context, itemIDs []int64) (map[int64][]*model.Account, error) {
	return s.accountsByConnectionSource(ctx, accounts.SourceTablePlaidItem, itemIDs)
}

func (s *Store) accountsByConnectionSource(ctx context.Context, sourceTable accounts.SourceTable, sourceIDs []int64) (map[int64][]*model.Account, error) {
	rows, err := s.q.AccountsByConnectionSources(ctx, dbgen.AccountsByConnectionSourcesParams{SourceTable: string(sourceTable), SourceIds: sourceIDs})
	toItemAccount := func(row dbgen.AccountsByConnectionSourcesRow) (int64, *model.Account) {
		return row.SourceID, AccountFromRow(row.Account, row.OwnerName)
	}
	return dbutil.GroupRows(rows, err, toItemAccount)
}

func (s *Store) UpsertAccount(ctx context.Context, externalID string, account *model.Account) error {
	id, err := s.UpsertAccountWithExternalID(ctx, externalID, account)
	if err != nil {
		return err
	}
	account.ID = model.New(model.GlobalIDAccount, id)
	return nil
}

func (s *Store) UpsertAccountWithExternalID(ctx context.Context, externalID string, account *model.Account) (int64, error) {
	ownerID := account.Owner.ID.Int64()
	connID := accountConnectionID(account)
	return s.q.UpsertAccount(ctx, dbgen.UpsertAccountParams{
		ExternalID:   externalID,
		ConnectionID: connID,
		OwnerID:      ownerID,
		Name:         account.Name,
		Type:         string(account.Type),
		Subtype:      account.Subtype,
		Mask:         account.Mask,
		Notes:        account.Notes,
		IsClosed:     account.Closed,
		IsHidden:     account.Hidden,
		NeedsReview:  account.NeedsReview,
	})
}

func (s *Store) CreateManualAccount(ctx context.Context, input model.CreateManualAccountInput) (*model.Account, error) {
	ownerID := input.OwnerID.Int64()
	owner, err := s.OwnerByID(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("lookup owner: %w", err)
	}
	if owner == nil {
		return nil, apierror.Publicf("unknown owner id %d", ownerID)
	}

	var connID *int64
	if input.ConnectionID != nil {
		connectionID := input.ConnectionID.Int64()
		conn, err := s.ConnectionByID(ctx, connectionID)
		if err != nil {
			return nil, fmt.Errorf("lookup connection: %w", err)
		}
		if conn == nil {
			return nil, apierror.Publicf("connection %d not found", connectionID)
		}
		connID = &connectionID
	}

	externalID := manualAccountID(connID, input.Name, ownerID)
	accountType := strings.ToUpper(string(input.Type))
	isClosed := input.Closed != nil && *input.Closed
	isHidden := input.Hidden != nil && *input.Hidden

	id, err := s.q.InsertManualAccount(ctx, dbgen.InsertManualAccountParams{ExternalID: externalID, ConnectionID: connID, OwnerID: ownerID, Name: input.Name, Type: accountType, Notes: normalizedNotes(input.Notes), IsClosed: isClosed, IsHidden: isHidden})
	if errors.Is(err, sql.ErrNoRows) {
		row, lookupErr := AccountByExternalID(ctx, s.q, externalID)
		id, err = row.Account.ID, lookupErr
	}
	if err != nil {
		return nil, fmt.Errorf("insert manual account: %w", err)
	}
	return s.AccountByID(ctx, id)
}

func (s *Store) UpdateAccount(ctx context.Context, id int64, input model.UpdateAccountInput) (*model.Account, error) {
	params, changed, err := s.accountUpdateParams(ctx, id, input)
	if err != nil {
		return nil, err
	}
	if !changed {
		return s.AccountByID(ctx, id)
	}

	if err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		rows, err := q.UpdateAccountFields(ctx, params)
		if err != nil {
			return err
		}
		if rows == 0 {
			return apierror.Publicf("account %d not found", id)
		}
		if input.Hidden != nil {
			if err := q.UpdateTransactionsHiddenByAccount(ctx, dbgen.UpdateTransactionsHiddenByAccountParams{IsHidden: *input.Hidden, AccountID: id}); err != nil {
				return fmt.Errorf("update transactions hidden: %w", err)
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return s.AccountByID(ctx, id)
}

func (s *Store) RemoveManualAccount(ctx context.Context, id int64) (bool, error) {
	account, err := s.AccountByID(ctx, id)
	if err != nil {
		return false, fmt.Errorf("lookup account: %w", err)
	}
	if !account.Manual {
		return false, apierror.Publicf("account %d is not manual", id)
	}

	if err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		rowsAffected, err := q.DeleteManualAccountByID(ctx, dbgen.DeleteManualAccountByIDParams{ID: id})
		if err != nil {
			return fmt.Errorf("delete manual account: %w", err)
		}
		if rowsAffected == 0 {
			return apierror.Publicf("account %d not found", id)
		}
		return nil
	}); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) AccountByID(ctx context.Context, id int64) (*model.Account, error) {
	row, err := dbutil.FirstRow(s.q.AccountRecords(ctx, dbgen.AccountRecordsParams{ID: &id}))
	if err != nil {
		return nil, err
	}
	return AccountFromRow(row.Account, row.OwnerName), nil
}

func AccountByExternalID(ctx context.Context, q *dbgen.Queries, externalID string) (dbgen.AccountRecordsRow, error) {
	return dbutil.FirstRow(q.AccountRecords(ctx, dbgen.AccountRecordsParams{ExternalIds: []string{externalID}}))
}

func (s *Store) HiddenAccountIDsByConnection(ctx context.Context, connectionID int64) (map[string]bool, error) {
	rows, err := s.q.HiddenAccountIDsByConnection(ctx, dbgen.HiddenAccountIDsByConnectionParams{ConnectionID: &connectionID})
	toHidden := func(id string) (string, bool) { return id, true }
	return dbutil.AssociateRows(rows, err, toHidden)
}

func (s *Store) AccountsByRuleIDs(ctx context.Context, ruleIDs []int64) (map[int64][]*model.Account, error) {
	rows, err := s.q.AccountsByRuleIDs(ctx, dbgen.AccountsByRuleIDsParams{RuleIds: ruleIDs})
	toRuleAccount := func(row dbgen.AccountsByRuleIDsRow) (int64, *model.Account) {
		return row.RuleID, AccountFromRow(row.Account, row.OwnerName)
	}
	return dbutil.GroupRows(rows, err, toRuleAccount)
}

func (s *Store) accountUpdateParams(ctx context.Context, id int64, input model.UpdateAccountInput) (dbgen.UpdateAccountFieldsParams, bool, error) {
	params := dbgen.UpdateAccountFieldsParams{ID: id}
	var changed bool
	if input.Name != nil {
		params.SetName = true
		params.Name = *input.Name
		changed = true
	}
	if input.OwnerID != nil {
		ownerID := input.OwnerID.Int64()
		owner, err := s.OwnerByID(ctx, ownerID)
		if err != nil {
			return params, false, fmt.Errorf("lookup owner: %w", err)
		}
		if owner == nil {
			return params, false, fmt.Errorf("unknown owner id %d", ownerID)
		}
		params.SetOwner = true
		params.OwnerID = &ownerID
		changed = true
	}
	if input.Type != nil {
		current, err := s.AccountByID(ctx, id)
		if err != nil {
			return params, false, fmt.Errorf("lookup account: %w", err)
		}
		if *input.Type == model.AccountTypeProperty || current.Type == model.AccountTypeProperty {
			return params, false, apierror.Publicf("real estate account type is managed by linkRealEstate/unlinkRealEstate")
		}
		cryptoTypeChange := *input.Type == model.AccountTypeCryptoWallet || current.Type == model.AccountTypeCryptoWallet
		if cryptoTypeChange && !current.Manual {
			return params, false, apierror.Publicf("crypto wallet account type is managed by linkEVMWallet/unlinkEVMWallet")
		}
		params.SetType = true
		params.Type = strings.ToUpper(string(*input.Type))
		changed = true
	}
	if input.Subtype != nil {
		subtype := strings.TrimSpace(*input.Subtype)
		params.SetSubtype = true
		changed = true
		if subtype == "" {
			params.Subtype = nil
		} else {
			accountType, err := s.effectiveAccountType(ctx, id, input)
			if err != nil {
				return params, false, err
			}
			if !isValidSubtypeForType(accountType, subtype) {
				return params, false, apierror.Publicf("subtype %q is not valid for account type %s", subtype, accountType)
			}
			params.Subtype = &subtype
		}
	}
	if input.Notes != nil {
		params.SetNotes = true
		changed = true
		params.Notes = normalizedNotes(input.Notes)
	}
	if input.Closed != nil {
		params.SetClosed = true
		params.IsClosed = *input.Closed
		changed = true
	}
	if input.Hidden != nil {
		params.SetHidden = true
		params.IsHidden = *input.Hidden
		changed = true
	}
	return params, changed, nil
}

func normalizedNotes(notes *string) *string {
	if notes == nil {
		return nil
	}
	return lo.EmptyableToPtr(strings.TrimSpace(*notes))
}

// effectiveAccountType returns the account type that a subtype must be validated
// against: the newly chosen type when the same update changes it, otherwise the
// account's current stored type.
func (s *Store) effectiveAccountType(ctx context.Context, id int64, input model.UpdateAccountInput) (model.AccountType, error) {
	if input.Type != nil {
		return model.AccountType(strings.ToUpper(string(*input.Type))), nil
	}
	account, err := s.AccountByID(ctx, id)
	if err != nil {
		return "", fmt.Errorf("lookup account type: %w", err)
	}
	return account.Type, nil
}
