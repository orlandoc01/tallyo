package accounts

import (
	"testing"

	"tallyo/internal/graph/model"
)

func TestTypeFromPlaid(t *testing.T) {
	tests := map[string]model.AccountType{
		"depository": model.AccountTypeDepository,
		"credit":     model.AccountTypeCredit,
		"loan":       model.AccountTypeLoan,
		"investment": model.AccountTypeInvestment,
		"other":      model.AccountTypeOther,
		"unknown":    model.AccountTypeOther,
	}
	for input, want := range tests {
		if got := TypeFromPlaid(input); got != want {
			t.Fatalf("TypeFromPlaid(%q) = %s, want %s", input, got, want)
		}
	}
}
