package mcpserver

import (
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
)

type leanAsset struct {
	ID         string                `json:"id"`
	AssetType  model.AssetType       `json:"assetType"`
	Identifier string                `json:"identifier"`
	Name       *string               `json:"name,omitempty"`
	Classifier model.AssetClassifier `json:"classifier"`
}

func mapAsset(asset *model.Asset) leanAsset {
	return leanAsset{ID: asset.ID.EncodedString(), AssetType: asset.AssetType, Identifier: asset.Identifier, Name: asset.Name, Classifier: asset.Classifier}
}

type leanAccount struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	Subtype   *string `json:"subtype,omitempty"`
	OwnerID   string  `json:"ownerId"`
	OwnerName string  `json:"ownerName"`
	Manual    bool    `json:"manual,omitempty"`
	Closed    bool    `json:"closed,omitempty"`
	Hidden    bool    `json:"hidden,omitempty"`
}

func mapAccount(a *model.Account) leanAccount {
	return leanAccount{
		ID:        a.ID.EncodedString(),
		Name:      a.Name,
		Type:      string(a.Type),
		Subtype:   a.Subtype,
		OwnerID:   a.Owner.ID.EncodedString(),
		OwnerName: a.Owner.Name,
		Manual:    a.Manual,
		Closed:    a.Closed,
		Hidden:    a.Hidden,
	}
}

func mapAccounts(accounts []*model.Account) []leanAccount {
	return u.Map(accounts, mapAccount)
}

type leanList[T any] struct {
	Items []T `json:"items"`
}

func mapList[S, T any](items []S, f func(S) T) *leanList[T] {
	return &leanList[T]{Items: u.Map(items, f)}
}

func mapAccountList(list *model.AccountList) *leanList[leanAccount] {
	return mapList(list.Items, mapAccount)
}

type leanAccountPayload struct {
	Account leanAccount `json:"account"`
}

func mapAccountPayload(a *model.Account) leanAccountPayload {
	return leanAccountPayload{Account: mapAccount(a)}
}

type leanCategoryRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func mapCategoryRef(c *model.Category) leanCategoryRef {
	return leanCategoryRef{ID: c.ID.EncodedString(), Name: c.Name}
}
