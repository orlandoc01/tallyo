package accountsdb

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/graph/model"
)

func manualAccountID(connectionID *int64, name string, ownerID int64) string {
	key := "manual"
	if connectionID != nil {
		key = fmt.Sprint(*connectionID)
	}
	h := fmt.Sprintf("%s|%s|%d", key, name, ownerID)
	sum := sha256.Sum256([]byte(h))
	return "manual-" + hex.EncodeToString(sum[:])[:12]
}

func AccountFromRow(a dbgen.Account, ownerName string) *model.Account {
	account := &model.Account{
		ID:          model.New(model.GlobalIDAccount, a.ID),
		Owner:       &model.Owner{ID: model.New(model.GlobalIDOwner, a.OwnerID), Name: ownerName},
		Name:        a.Name,
		Type:        model.AccountType(a.Type),
		Subtype:     a.Subtype,
		Mask:        a.Mask,
		Notes:       a.Notes,
		Closed:      a.IsClosed,
		Hidden:      a.IsHidden,
		NeedsReview: a.NeedsReview,
		Manual:      a.Manual,
		CreatedAt:   a.CreatedAt,
		UpdatedAt:   a.UpdatedAt,
	}
	if a.ConnectionID != nil {
		account.Connection = &model.Connection{ID: model.New(model.GlobalIDConnection, *a.ConnectionID)}
	}
	return account
}

func accountFromRecordRow(r dbgen.AccountRecordsRow) *model.Account {
	return AccountFromRow(r.Account, r.OwnerName)
}

func accountConnectionID(account *model.Account) *int64 {
	if account == nil || account.Connection == nil {
		return nil
	}
	if account.Connection.ID.Int64() != 0 {
		connectionID := account.Connection.ID.Int64()
		return &connectionID
	}
	return nil
}
