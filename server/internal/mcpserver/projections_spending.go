package mcpserver

import (
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	u "tallyo/internal/utils"
)

type leanCashFlowBreakdown struct {
	CategoryID       string      `json:"categoryId"`
	CategoryName     string      `json:"categoryName"`
	Total            money.Cents `json:"total"`
	TransactionCount int32       `json:"transactionCount"`
	PercentOfTotal   float64     `json:"percentOfTotal"`
}

func mapCashFlowBreakdowns(breakdowns []*model.CashFlowBreakdown) []leanCashFlowBreakdown {
	toBreakdown := func(b *model.CashFlowBreakdown) leanCashFlowBreakdown {
		ref := mapCategoryRef(b.Category)
		return leanCashFlowBreakdown{
			CategoryID:       ref.ID,
			CategoryName:     ref.Name,
			Total:            b.Total,
			TransactionCount: b.TransactionCount,
			PercentOfTotal:   b.PercentOfTotal,
		}
	}
	return u.Map(breakdowns, toBreakdown)
}

type leanCashFlowPeriod struct {
	PeriodLabel        string                  `json:"periodLabel"`
	PeriodStart        model.Date              `json:"periodStart"`
	PeriodEnd          model.Date              `json:"periodEnd"`
	Summary            *model.CashFlowSummary  `json:"summary"`
	IncomeByCategory   []leanCashFlowBreakdown `json:"incomeByCategory"`
	ExpensesByCategory []leanCashFlowBreakdown `json:"expensesByCategory"`
}

type leanCashFlowReport struct {
	Periods []leanCashFlowPeriod `json:"periods"`
}

func mapCashFlowReport(report *model.CashFlowReport) *leanCashFlowReport {
	toPeriod := func(p *model.CashFlowPeriod) leanCashFlowPeriod {
		return leanCashFlowPeriod{
			PeriodLabel:        p.PeriodLabel,
			PeriodStart:        p.PeriodStart,
			PeriodEnd:          p.PeriodEnd,
			Summary:            p.Summary,
			IncomeByCategory:   mapCashFlowBreakdowns(p.IncomeByCategory),
			ExpensesByCategory: mapCashFlowBreakdowns(p.ExpensesByCategory),
		}
	}
	return &leanCashFlowReport{Periods: u.Map(report.Periods, toPeriod)}
}

type leanCategorySpendingAggregate struct {
	CategoryID       string                          `json:"categoryId"`
	CategoryName     string                          `json:"categoryName"`
	TotalAmount      money.Cents                     `json:"totalAmount"`
	TransactionCount int32                           `json:"transactionCount"`
	PercentOfTotal   float64                         `json:"percentOfTotal"`
	Periods          []*model.CategorySpendingPeriod `json:"periods"`
}

type leanSpendingByCategoryReport struct {
	TotalAmount      money.Cents                      `json:"totalAmount"`
	TransactionCount int32                            `json:"transactionCount"`
	Periods          []*model.SpendingAggregatePeriod `json:"periods"`
	Categories       []leanCategorySpendingAggregate  `json:"categories"`
}

func mapSpendingByCategoryReport(report *model.SpendingByCategoryReport) *leanSpendingByCategoryReport {
	toCategory := func(c *model.CategorySpendingAggregate) leanCategorySpendingAggregate {
		ref := mapCategoryRef(c.Category)
		return leanCategorySpendingAggregate{
			CategoryID:       ref.ID,
			CategoryName:     ref.Name,
			TotalAmount:      c.TotalAmount,
			TransactionCount: c.TransactionCount,
			PercentOfTotal:   c.PercentOfTotal,
			Periods:          c.Periods,
		}
	}
	return &leanSpendingByCategoryReport{
		TotalAmount:      report.TotalAmount,
		TransactionCount: report.TransactionCount,
		Periods:          report.Periods,
		Categories:       u.Map(report.Categories, toCategory),
	}
}
