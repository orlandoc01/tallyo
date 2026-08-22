package model

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"strconv"
	"strings"

	"github.com/samber/lo"

	"tallyo/internal/apierror"
)

type GlobalIDType string

const (
	GlobalIDPlaidItem            GlobalIDType = "PlaidItem"
	GlobalIDSimpleFinConnection  GlobalIDType = "SimpleFinConnection"
	GlobalIDAsset                GlobalIDType = "Asset"
	GlobalIDAccount              GlobalIDType = "Account"
	GlobalIDConnection           GlobalIDType = "Connection"
	GlobalIDOwner                GlobalIDType = "Owner"
	GlobalIDRecurringCharge      GlobalIDType = "RecurringCharge"
	GlobalIDUser                 GlobalIDType = "User"
	GlobalIDBudget               GlobalIDType = "Budget"
	GlobalIDCategory             GlobalIDType = "Category"
	GlobalIDCategoryGroup        GlobalIDType = "CategoryGroup"
	GlobalIDRule                 GlobalIDType = "Rule"
	GlobalIDTag                  GlobalIDType = "Tag"
	GlobalIDTransaction          GlobalIDType = "Transaction"
	GlobalIDBalanceReview        GlobalIDType = "BalanceSnapshotReview"
	GlobalIDSnapshot             GlobalIDType = "AccountSnapshot"
	GlobalIDSimpleFinAccessToken GlobalIDType = "SimpleFinAccessToken"
)

const globalIDVersion = "v1"

func (t GlobalIDType) Str() string {
	return string(t)
}

type GlobalID struct {
	Type  GlobalIDType
	idInt int64
}

func New(typ GlobalIDType, id int64) GlobalID {
	return GlobalID{Type: typ, idInt: id}
}

func EncodeGlobalID(typeName GlobalIDType, localID string) string {
	payload := strings.Join([]string{globalIDVersion, typeName.Str(), localID}, ":")
	return base64.RawURLEncoding.EncodeToString([]byte(payload))
}

func DecodeGlobalID(id string) (GlobalID, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil {
		return GlobalID{}, invalidGlobalID()
	}
	parts := strings.SplitN(string(decoded), ":", 3)
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return GlobalID{}, invalidGlobalID()
	}
	if parts[0] != globalIDVersion {
		return GlobalID{}, invalidGlobalID()
	}
	typ := GlobalIDType(parts[1])
	if !typ.IsValid() {
		return GlobalID{}, invalidGlobalID()
	}
	n, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil {
		return GlobalID{}, invalidGlobalID()
	}
	globalID := New(typ, n)
	if globalID.EncodedString() != id {
		return GlobalID{}, invalidGlobalID()
	}

	return globalID, nil
}

func invalidGlobalID() error {
	return apierror.New("invalid global id", apierror.CodeBadUserInput)
}

func (t GlobalIDType) IsValid() bool {
	switch t {
	case GlobalIDPlaidItem,
		GlobalIDSimpleFinConnection,
		GlobalIDAsset,
		GlobalIDAccount,
		GlobalIDConnection,
		GlobalIDOwner,
		GlobalIDRecurringCharge,
		GlobalIDUser,
		GlobalIDBudget,
		GlobalIDCategory,
		GlobalIDCategoryGroup,
		GlobalIDRule,
		GlobalIDTag,
		GlobalIDTransaction,
		GlobalIDBalanceReview,
		GlobalIDSnapshot,
		GlobalIDSimpleFinAccessToken:
		return true
	default:
		return false
	}
}

func (g GlobalID) MarshalGQL(w io.Writer) {
	data, err := json.Marshal(g.EncodedString())
	if err != nil {
		panic(err)
	}
	_, _ = w.Write(data)
}

func (g *GlobalID) UnmarshalGQL(v any) error {
	id, ok := v.(string)
	if !ok {
		return apierror.Publicf("global id must be a string")
	}
	decoded, err := DecodeGlobalID(id)
	if err != nil {
		return err
	}
	*g = decoded
	return nil
}

func (g GlobalID) MarshalJSON() ([]byte, error) {
	return json.Marshal(g.EncodedString())
}

func (g *GlobalID) UnmarshalJSON(data []byte) error {
	var id string
	if err := json.Unmarshal(data, &id); err != nil {
		return err
	}
	decoded, err := DecodeGlobalID(id)
	if err != nil {
		return err
	}
	*g = decoded
	return nil
}

func (g GlobalID) Int64() int64 {
	return g.idInt
}

func (g GlobalID) String() string {
	return g.EncodedString()
}

func (g GlobalID) EncodedString() string {
	idStr := strconv.FormatInt(g.idInt, 10)
	return EncodeGlobalID(g.Type, idStr)
}

func (g GlobalID) ValidateType(expectedType GlobalIDType) error {
	if g.Type != expectedType {
		return apierror.Publicf("wrong global id type %q, expected %q", g.Type, expectedType)
	}
	return nil
}

func (g GlobalID) Int64OfType(expectedType GlobalIDType) (int64, error) {
	if err := g.ValidateType(expectedType); err != nil {
		return 0, err
	}
	return g.Int64(), nil
}

func LocalInt64IDsPtr(ids []*GlobalID) []int64 {
	toLocalID := func(id *GlobalID, _ int) (int64, bool) {
		if id == nil {
			return 0, false
		}
		return id.Int64(), true
	}
	return lo.FilterMap(ids, toLocalID)
}

func LocalInt64IDsOfTypePtr(ids []*GlobalID, expectedType GlobalIDType) ([]int64, error) {
	localIDs := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id == nil {
			continue
		}
		if err := id.ValidateType(expectedType); err != nil {
			return nil, err
		}
		localIDs = append(localIDs, id.Int64())
	}
	return localIDs, nil
}

type globalIDTypePair struct {
	ids          []*GlobalID
	expectedType GlobalIDType
}

func validateGlobalIDTypePairs(pairs ...globalIDTypePair) error {
	for _, pair := range pairs {
		if _, err := LocalInt64IDsOfTypePtr(pair.ids, pair.expectedType); err != nil {
			return err
		}
	}
	return nil
}

func ValidateTransactionsFilterIDTypes(filter *TransactionsFilter) error {
	if filter == nil {
		return nil
	}
	return validateFilterIDTypes(filter.CategoryIds, filter.AccountIds, filter.OwnerIds, filter.TagIds)
}

func ValidateSpendingFilterIDTypes(filter *SpendingFilter) error {
	if filter == nil {
		return nil
	}
	return validateFilterIDTypes(filter.CategoryIds, filter.AccountIds, filter.OwnerIds, filter.TagIds)
}

func validateFilterIDTypes(categoryIDs, accountIDs, ownerIDs, tagIDs []*GlobalID) error {
	return validateGlobalIDTypePairs(
		globalIDTypePair{ids: categoryIDs, expectedType: GlobalIDCategory},
		globalIDTypePair{ids: accountIDs, expectedType: GlobalIDAccount},
		globalIDTypePair{ids: ownerIDs, expectedType: GlobalIDOwner},
		globalIDTypePair{ids: tagIDs, expectedType: GlobalIDTag},
	)
}
