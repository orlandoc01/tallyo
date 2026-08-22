package wealth

import (
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
)

func TestLiabilityCategory(t *testing.T) {
	mortgage := "mortgage"
	auto := "auto"
	student := "student"
	unknown := "unknown-subtype"

	cases := []struct {
		name     string
		account  *model.Account
		expected model.LiabilityCategory
	}{
		{"credit card", &model.Account{Type: model.AccountTypeCredit}, model.LiabilityCategoryCard},
		{"mortgage", &model.Account{Type: model.AccountTypeLoan, Subtype: &mortgage}, model.LiabilityCategoryMortgage},
		{"auto loan", &model.Account{Type: model.AccountTypeLoan, Subtype: &auto}, model.LiabilityCategoryLoan},
		{"student loan", &model.Account{Type: model.AccountTypeLoan, Subtype: &student}, model.LiabilityCategoryLoan},
		{"unknown loan subtype", &model.Account{Type: model.AccountTypeLoan, Subtype: &unknown}, model.LiabilityCategoryOther},
		{"nil subtype loan", &model.Account{Type: model.AccountTypeLoan}, model.LiabilityCategoryOther},
		{"other account type", &model.Account{Type: model.AccountTypeDepository}, model.LiabilityCategoryOther},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := liabilityCategory(tc.account)
			if got != tc.expected {
				t.Errorf("liabilityCategory(%v) = %v, want %v", tc.name, got, tc.expected)
			}
		})
	}
}

func TestLiabilityBreakdown(t *testing.T) {
	owner := &model.Owner{ID: model.New(model.GlobalIDOwner, 1), Name: "alex"}
	cardAccount := &model.Account{ID: model.New(model.GlobalIDAccount, 1), Type: model.AccountTypeCredit, Name: "Visa", Owner: owner}
	mortgage := "mortgage"
	mortgageAccount := &model.Account{ID: model.New(model.GlobalIDAccount, 1), Type: model.AccountTypeLoan, Subtype: &mortgage, Name: "Home Loan", Owner: owner}

	balances := []LiabilityAccountBalance{
		{Account: cardAccount, BalanceUSD: 500},
		{Account: mortgageAccount, BalanceUSD: 300},
	}
	total := money.Cents(800)
	result := liabilityBreakdown(balances, total)

	if len(result) != 2 {
		t.Fatalf("expected 2 categories, got %d", len(result))
	}
	if result[0].Category != model.LiabilityCategoryCard || result[0].ValueUsd != 500 {
		t.Errorf("first category: %+v", result[0])
	}
	if result[1].Category != model.LiabilityCategoryMortgage || result[1].ValueUsd != 300 {
		t.Errorf("second category: %+v", result[1])
	}
	if result[0].PercentOfLiabilities != 500.0/800.0*100 {
		t.Errorf("card percent = %v", result[0].PercentOfLiabilities)
	}
}

func TestLiabilityBreakdownManualSnapshotUsesAccountCategory(t *testing.T) {
	owner := &model.Owner{ID: model.New(model.GlobalIDOwner, 1), Name: "alex"}
	cardAccount := &model.Account{ID: model.New(model.GlobalIDAccount, 1), Type: model.AccountTypeCredit, Name: "Visa", Owner: owner}
	manualAccount := &model.Account{ID: model.New(model.GlobalIDAccount, 1), Type: model.AccountTypeOther, Name: "Manual Debt", Owner: owner}
	balances := []LiabilityAccountBalance{
		{Account: cardAccount, BalanceUSD: 400},
		{Account: manualAccount, BalanceUSD: 100},
	}
	total := money.Cents(500)
	result := liabilityBreakdown(balances, total)

	if len(result) != 2 {
		t.Fatalf("expected 2 categories (CARD + OTHER), got %d", len(result))
	}
	var other *model.LiabilityBreakdown
	for _, r := range result {
		if r.Category == model.LiabilityCategoryOther {
			other = r
		}
	}
	if other == nil {
		t.Fatal("expected OTHER category for manual liabilities")
	}
	if other.ValueUsd != 100 {
		t.Errorf("OTHER valueUSD = %v, want 100", other.ValueUsd)
	}
}

func TestLiabilityBreakdownEmpty(t *testing.T) {
	result := liabilityBreakdown(nil, 0)
	if len(result) != 0 {
		t.Errorf("expected empty breakdown, got %d items", len(result))
	}
}
