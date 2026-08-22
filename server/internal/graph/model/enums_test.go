package model

import (
	"bytes"
	"io"
	"testing"
)

func TestWealthEnumHelpers(t *testing.T) {
	if RoleFromName("admin") != RoleAdmin || RoleName(RoleAdmin) != "admin" {
		t.Fatal("role name conversion failed")
	}
	tests := []struct {
		name string
		run  func(*testing.T)
	}{
		{name: "AssetClassifier", run: testEnum[AssetClassifier, *AssetClassifier]("CASH", AssetClassifierCash)},
		{name: "AssetType", run: testEnum[AssetType, *AssetType]("SECURITY", AssetTypeSecurity)},
		{name: "NetWorthRange", run: testEnum[NetWorthRange, *NetWorthRange]("ONE_YEAR", NetWorthRangeOneYear)},
		{name: "AccountType", run: testEnum[AccountType, *AccountType]("DEPOSITORY", AccountTypeDepository)},
		{name: "CategoryKind", run: testEnum[CategoryKind, *CategoryKind]("EXPENSE", CategoryKindExpense)},
		{name: "Granularity", run: testEnum[Granularity, *Granularity]("MONTHLY", GranularityMonthly)},
		{name: "PlaidEnvironment", run: testEnum[PlaidEnvironment, *PlaidEnvironment]("SANDBOX", PlaidEnvironmentSandbox)},
		{name: "PlaidItemHealthState", run: testEnum[PlaidItemHealthState, *PlaidItemHealthState]("HEALTHY", PlaidItemHealthStateHealthy)},
		{name: "RecurrenceInterval", run: testEnum[RecurrenceInterval, *RecurrenceInterval]("MONTHLY", RecurrenceIntervalMonthly)},
		{name: "RecurringStreamStatus", run: testEnum[RecurringStreamStatus, *RecurringStreamStatus]("MATURE", RecurringStreamStatusMature)},
		{name: "Role", run: testEnum[Role, *Role]("ADMIN", RoleAdmin)},
		{name: "SortDirection", run: testEnum[SortDirection, *SortDirection]("ASC", SortDirectionAsc)},
		{name: "TransactionSortField", run: testEnum[TransactionSortField, *TransactionSortField]("DATE", TransactionSortFieldDate)},
	}
	for _, test := range tests {
		t.Run(test.name, test.run)
	}
}

type gqlEnum interface {
	~string
	comparable
	IsValid() bool
	String() string
	MarshalGQL(io.Writer)
}

type gqlEnumPointer[E gqlEnum] interface {
	*E
	UnmarshalGQL(any) error
}

func testEnum[E gqlEnum, PE gqlEnumPointer[E]](wire string, expected E) func(*testing.T) {
	return func(t *testing.T) {
		t.Helper()
		var value E
		if err := PE(&value).UnmarshalGQL(wire); err != nil || value != expected {
			t.Fatalf("UnmarshalGQL() = %v, %v", value, err)
		}
		if value.String() != wire || !value.IsValid() || E("BAD").IsValid() {
			t.Fatalf("enum helpers failed for %T", value)
		}
		assertMarshal(t, value.MarshalGQL, `"`+wire+`"`)
		if err := PE(new(E)).UnmarshalGQL("BAD"); err == nil {
			t.Fatalf("%T should reject bad value", value)
		}
		if err := PE(new(E)).UnmarshalGQL(123); err == nil {
			t.Fatalf("%T should reject non-string", value)
		}
	}
}

func assertMarshal(t *testing.T, marshal func(w io.Writer), expected string) {
	t.Helper()
	var buf bytes.Buffer
	marshal(&buf)
	if buf.String() != expected {
		t.Fatalf("MarshalGQL() = %q, want %q", buf.String(), expected)
	}
}
