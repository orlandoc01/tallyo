package model

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"strings"
	"tallyo/internal/utils/must"
	"testing"
)

func TestGlobalIDRoundTrip(t *testing.T) {
	id := New(GlobalIDOwner, 123)
	encoded := id.EncodedString()

	decoded, err := DecodeGlobalID(encoded)
	must.NoErr(t, err)
	if decoded.Type != GlobalIDOwner || decoded.Int64() != 123 {
		t.Fatalf("DecodeGlobalID() = %#v", decoded)
	}

	var gql GlobalID
	must.NoErr(t, gql.UnmarshalGQL(encoded))
	if gql != id {
		t.Fatalf("UnmarshalGQL() = %#v", gql)
	}

	var buf bytes.Buffer
	id.MarshalGQL(&buf)
	if got, want := buf.String(), `"`+encoded+`"`; got != want {
		t.Fatalf("MarshalGQL() = %s, want %s", got, want)
	}
}

func TestGlobalIDJSONRoundTrip(t *testing.T) {
	id := New(GlobalIDCategory, 1<<32)
	data, err := json.Marshal(id)
	must.NoErr(t, err)

	var decoded GlobalID
	must.NoErr(t, json.Unmarshal(data, &decoded))
	if decoded != id {
		t.Fatalf("UnmarshalJSON() = %#v", decoded)
	}

	if intID := decoded.Int64(); intID != 1<<32 {
		t.Fatalf("Int64() = %d", intID)
	}
}

func TestGlobalIDRejectsInvalidInput(t *testing.T) {
	var id GlobalID
	if err := id.UnmarshalGQL(123); err == nil {
		t.Fatal("UnmarshalGQL() accepted non-string input")
	}
	if err := id.UnmarshalGQL("not-base64"); err == nil {
		t.Fatal("UnmarshalGQL() accepted invalid ID")
	}
}

func TestDecodeGlobalIDRejectsInvalidValues(t *testing.T) {
	cases := map[string]string{
		"malformed base64url":               "not?base64",
		"missing separator":                 rawGlobalID("v1Account123"),
		"missing version":                   rawGlobalID(":Account:123"),
		"unsupported version":               rawGlobalID("v2:Account:123"),
		"unsupported type":                  rawGlobalID("v1:Unknown:123"),
		"empty type":                        rawGlobalID("v1::123"),
		"empty local id":                    rawGlobalID("v1:Account:"),
		"non-integer local id for int type": rawGlobalID("v1:Account:not-int"),
		"non-canonical local id":            rawGlobalID("v1:Account:00123"),
	}
	for name, id := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeGlobalID(id); err == nil || err.Error() != "invalid global id" {
				t.Fatalf("DecodeGlobalID() error = %v, want invalid global id", err)
			}
		})
	}
}

func TestAssetGlobalIDWireCompatibility(t *testing.T) {
	encoded := rawGlobalID("v1:Asset:123")
	id, err := DecodeGlobalID(encoded)
	must.NoErr(t, err)
	if got := id.Int64(); got != 123 {
		t.Fatalf("Int64() = %d", got)
	}
	if got := id.EncodedString(); got != encoded {
		t.Fatalf("EncodedString() = %q, want %q", got, encoded)
	}
	if got := id.String(); got != encoded {
		t.Fatalf("String() = %q, want %q", got, encoded)
	}
	must.NoErr(t, id.ValidateType(GlobalIDAsset))
	if err := id.ValidateType(GlobalIDAccount); err == nil || !strings.Contains(err.Error(), "wrong global id type") {
		t.Fatalf("ValidateType(wrong) error = %v", err)
	}
}

func TestGlobalIDIntAccessors(t *testing.T) {
	id := New(GlobalIDTransaction, 42)
	if got := id.Int64(); got != 42 {
		t.Fatalf("Int64() = %d", got)
	}
	must.NoErr(t, id.ValidateType(GlobalIDTransaction))
	if err := id.ValidateType(GlobalIDAccount); err == nil || !strings.Contains(err.Error(), "wrong global id type") {
		t.Fatalf("ValidateType(wrong) error = %v", err)
	}
	if got, err := id.Int64OfType(GlobalIDTransaction); err != nil || got != 42 {
		t.Fatalf("Int64OfType() = %d, %v", got, err)
	}
}

func TestGlobalIDLocalIDHelpers(t *testing.T) {
	owner := New(GlobalIDOwner, 42)
	account := New(GlobalIDAccount, 1)
	if got := LocalInt64IDsPtr([]*GlobalID{&owner, nil}); len(got) != 1 || got[0] != 42 {
		t.Fatalf("LocalInt64IDsPtr() = %#v", got)
	}
	if got, err := LocalInt64IDsOfTypePtr([]*GlobalID{&owner, nil}, GlobalIDOwner); err != nil || len(got) != 1 || got[0] != 42 {
		t.Fatalf("LocalInt64IDsOfTypePtr(owner) = %#v, %v", got, err)
	}
	tag := New(GlobalIDTag, 42)
	if got, err := LocalInt64IDsOfTypePtr([]*GlobalID{&tag, nil}, GlobalIDTag); err != nil || len(got) != 1 || got[0] != 42 {
		t.Fatalf("LocalInt64IDsOfTypePtr() = %#v, %v", got, err)
	}
	if _, err := LocalInt64IDsOfTypePtr([]*GlobalID{&owner}, GlobalIDTag); err == nil {
		t.Fatal("LocalInt64IDsOfTypePtr() accepted wrong ID type")
	}
	if _, err := LocalInt64IDsOfTypePtr([]*GlobalID{&account}, GlobalIDAsset); err == nil {
		t.Fatal("LocalInt64IDsOfTypePtr() accepted wrong ID type")
	}
}

func TestValidateFilterIDTypes(t *testing.T) {
	account := New(GlobalIDAccount, 1)
	category := New(GlobalIDCategory, 1)
	owner := New(GlobalIDOwner, 1)
	tag := New(GlobalIDTag, 2)
	wrong := New(GlobalIDAsset, 1)

	must.NoErr(t, ValidateTransactionsFilterIDTypes(nil))
	must.NoErr(t, ValidateTransactionsFilterIDTypes(&TransactionsFilter{AccountIds: []*GlobalID{&account}, CategoryIds: []*GlobalID{&category}, OwnerIds: []*GlobalID{&owner}, TagIds: []*GlobalID{&tag}}))
	if err := ValidateTransactionsFilterIDTypes(&TransactionsFilter{CategoryIds: []*GlobalID{&wrong}}); err == nil {
		t.Fatal("ValidateTransactionsFilterIDTypes() accepted wrong category type")
	}
	if err := ValidateTransactionsFilterIDTypes(&TransactionsFilter{AccountIds: []*GlobalID{&wrong}}); err == nil {
		t.Fatal("ValidateTransactionsFilterIDTypes() accepted wrong account type")
	}
	if err := ValidateTransactionsFilterIDTypes(&TransactionsFilter{OwnerIds: []*GlobalID{&wrong}}); err == nil {
		t.Fatal("ValidateTransactionsFilterIDTypes() accepted wrong owner type")
	}
	if err := ValidateTransactionsFilterIDTypes(&TransactionsFilter{TagIds: []*GlobalID{&wrong}}); err == nil {
		t.Fatal("ValidateTransactionsFilterIDTypes() accepted wrong tag type")
	}

	must.NoErr(t, ValidateSpendingFilterIDTypes(nil))
	must.NoErr(t, ValidateSpendingFilterIDTypes(&SpendingFilter{AccountIds: []*GlobalID{&account}, CategoryIds: []*GlobalID{&category}, OwnerIds: []*GlobalID{&owner}, TagIds: []*GlobalID{&tag}}))
	if err := ValidateSpendingFilterIDTypes(&SpendingFilter{CategoryIds: []*GlobalID{&wrong}}); err == nil {
		t.Fatal("ValidateSpendingFilterIDTypes() accepted wrong category type")
	}
	if err := ValidateSpendingFilterIDTypes(&SpendingFilter{AccountIds: []*GlobalID{&wrong}}); err == nil {
		t.Fatal("ValidateSpendingFilterIDTypes() accepted wrong account type")
	}
	if err := ValidateSpendingFilterIDTypes(&SpendingFilter{OwnerIds: []*GlobalID{&wrong}}); err == nil {
		t.Fatal("ValidateSpendingFilterIDTypes() accepted wrong owner type")
	}
	if err := ValidateSpendingFilterIDTypes(&SpendingFilter{TagIds: []*GlobalID{&wrong}}); err == nil {
		t.Fatal("ValidateSpendingFilterIDTypes() accepted wrong tag type")
	}
}

func rawGlobalID(payload string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(payload))
}
