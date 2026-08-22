package mcpserver

import (
	"tallyo/internal/graph/model"
)

type leanPlaidCredentialRef struct {
	ID          int32   `json:"id"`
	ClientID    string  `json:"clientId"`
	Environment string  `json:"environment"`
	Label       *string `json:"label,omitempty"`
}

type leanPlaidCredential struct {
	leanPlaidCredentialRef
	ItemCount int32 `json:"itemCount"`
}

func mapPlaidCredentialRef(c *model.PlaidCredential) leanPlaidCredentialRef {
	return leanPlaidCredentialRef{
		ID:          c.ID,
		ClientID:    c.ClientID,
		Environment: string(c.Environment),
		Label:       c.Label,
	}
}

func mapPlaidCredential(c *model.PlaidCredential) leanPlaidCredential {
	return leanPlaidCredential{leanPlaidCredentialRef: mapPlaidCredentialRef(c), ItemCount: c.ItemCount}
}

func mapPlaidCredentialList(list *model.PlaidCredentialList) *leanList[leanPlaidCredential] {
	return mapList(list.Items, mapPlaidCredential)
}

type leanPlaidItem struct {
	ID              string                  `json:"id"`
	Credential      *leanPlaidCredentialRef `json:"credential,omitempty"`
	InstitutionID   *string                 `json:"institutionId,omitempty"`
	Accounts        []leanAccount           `json:"accounts"`
	HealthState     string                  `json:"healthState"`
	HealthErrorCode *string                 `json:"healthErrorCode,omitempty"`
	IsActive        bool                    `json:"isActive"`
}

func mapPlaidItem(item *model.PlaidItem) leanPlaidItem {
	lean := leanPlaidItem{
		ID:              item.ID.EncodedString(),
		InstitutionID:   item.InstitutionID,
		Accounts:        mapAccounts(item.Accounts),
		HealthState:     string(item.HealthState),
		HealthErrorCode: item.HealthErrorCode,
		IsActive:        item.IsActive,
	}
	if item.Credential != nil {
		credential := mapPlaidCredentialRef(item.Credential)
		lean.Credential = &credential
	}
	return lean
}

func mapPlaidItemList(list *model.PlaidItemList) *leanList[leanPlaidItem] {
	return mapList(list.Items, mapPlaidItem)
}
