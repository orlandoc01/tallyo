package wealth

import (
	"strings"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"

	"github.com/samber/lo"
)

func liabilityCategory(a *model.Account) model.LiabilityCategory {
	return liabilityCategoryFor(a.Type, a.Subtype)
}

func liabilityCategoryFor(accountType model.AccountType, subtype *string) model.LiabilityCategory {
	if accountType == model.AccountTypeCredit {
		return model.LiabilityCategoryCard
	}
	if accountType == model.AccountTypeLoan {
		switch strings.ToLower(lo.FromPtr(subtype)) {
		case "mortgage", "home equity":
			return model.LiabilityCategoryMortgage
		case "auto", "business", "commercial", "construction", "consumer",
			"line of credit", "loan", "overdraft", "student":
			return model.LiabilityCategoryLoan
		}
	}
	return model.LiabilityCategoryOther
}

func liabilityLabel(c model.LiabilityCategory) string {
	switch c {
	case model.LiabilityCategoryCard:
		return "Cards"
	case model.LiabilityCategoryMortgage:
		return "Mortgage"
	case model.LiabilityCategoryLoan:
		return "Loans"
	default:
		return "Other Liabilities"
	}
}

func liabilityBreakdown(balances []LiabilityAccountBalance, total money.Cents) []*model.LiabilityBreakdown {
	byCategory := lo.GroupBy(balances, func(b LiabilityAccountBalance) model.LiabilityCategory {
		return liabilityCategory(b.Account)
	})

	result := make([]*model.LiabilityBreakdown, 0, len(liabilitySeriesOrder))
	for _, cat := range liabilitySeriesOrder {
		items := byCategory[cat]
		value := lo.SumBy(items, func(b LiabilityAccountBalance) money.Cents { return b.BalanceUSD })
		if len(items) == 0 {
			continue
		}
		accounts := lo.Map(items, func(b LiabilityAccountBalance, _ int) *model.Account { return b.Account })
		pct := 0.0
		if total != 0 {
			pct = value.Dollars() / total.Dollars() * 100
		}
		result = append(result, &model.LiabilityBreakdown{
			Category:             cat,
			Label:                liabilityLabel(cat),
			ValueUsd:             value,
			PercentOfLiabilities: pct,
			AccountCount:         int32(len(items)),
			Accounts:             accounts,
		})
	}
	return result
}
